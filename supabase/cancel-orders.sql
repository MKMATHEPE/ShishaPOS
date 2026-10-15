begin;
-- Cancellation keeps an internal audit copy and restores recorded deductions only.
create table if not exists private.pos_order_stock_deductions (
  order_id bigint primary key,
  deductions jsonb not null default '[]'::jsonb
);
alter table private.pos_order_stock_deductions enable row level security;
revoke all on private.pos_order_stock_deductions from public, anon, authenticated;
create table if not exists private.cancelled_pos_orders (
  order_id bigint primary key,
  order_data jsonb not null,
  cancelled_by uuid not null,
  cancelled_at timestamptz not null default now()
);
alter table private.cancelled_pos_orders enable row level security;
revoke all on private.cancelled_pos_orders from public, anon, authenticated;

create or replace function private.deduct_pos_sale_stock()
returns trigger language plpgsql security definer set search_path='' as $$
declare stock_item public.pos_stock%rowtype; part jsonb; flavour_name text; flavour_key text; usage numeric; matched boolean:=false; consumable_rows integer:=0; deductions jsonb:='[]'::jsonb; remaining numeric;
begin
 if not private.is_active_pos_user() or new.stock_recorded_by is distinct from auth.uid() then raise exception 'Active POS user required' using errcode='42501'; end if;
 if new.type is null or new.payment is null or new.type not in ('full','refill') or new.payment not in ('cash','card') or new.price is null or new.price<0 or new.status is distinct from 'active' or new.pipe_returned is distinct from false or new.delivered_at is not null then raise exception 'Invalid sale'; end if;
 flavour_name:=case when jsonb_typeof(new.flavour)='object' then new.flavour->>'name' when jsonb_typeof(new.flavour)='string' then new.flavour#>>'{}' else null end;
 -- Shared ordering matches expense and stock-taking locks to avoid lost updates.
 for stock_item in select * from public.pos_stock order by id for update loop
  if stock_item.name in ('Coal','Mouth Pieces') and stock_item.category='consumable' then
   consumable_rows:=consumable_rows+1;
   update public.pos_stock set quantity=greatest(0,quantity-2) where id=stock_item.id;
   deductions:=deductions||jsonb_build_array(jsonb_build_object('stockId',stock_item.id,'quantity',least(greatest(stock_item.quantity,0),2)));
  elsif stock_item.name='Flavour' and stock_item.category='consumable' then
   for part in select value from jsonb_array_elements(stock_item.sub_items) loop
    if part->>'name'=flavour_name then
     flavour_key:=part->>'id';
     usage:=case when flavour_key in ('lk','bn','jk','hh') then 1::numeric/3.5 when flavour_key in ('mc','gm') then 0.25 else null end;
     if usage is null then raise exception 'Unknown flavour usage'; end if;
     update public.pos_stock s set sub_items=(select jsonb_agg(case when value->>'id'=flavour_key then jsonb_set(value,'{quantity}',to_jsonb(greatest(0,round((value->>'quantity')::numeric-usage,3)))) else value end order by ord) from jsonb_array_elements(s.sub_items) with ordinality a(value,ord)) where id=stock_item.id;
     remaining:=greatest(0,round((part->>'quantity')::numeric-usage,3));
     deductions:=deductions||jsonb_build_array(jsonb_build_object('stockId',stock_item.id,'flavourId',flavour_key,'quantity',(part->>'quantity')::numeric-remaining));
     matched:=true;exit;
    end if;
   end loop;
  end if;
 end loop;
 if not matched then raise exception 'Unknown flavour'; end if;
 if consumable_rows<>2 then raise exception 'Consumable inventory is incomplete'; end if;
 insert into private.pos_order_stock_deductions(order_id,deductions) values(new.id,deductions);
 return new;
end; $$;
create or replace function public.record_pos_sale(order_payload jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.pos_orders%rowtype; order_id bigint; sale_time timestamptz; sale_flavour jsonb; seller text; sale_date date; shift uuid;
begin
 if not private.is_active_pos_user() then raise exception 'Active POS user required' using errcode='42501'; end if;
 order_id:=(order_payload->>'id')::bigint;
 sale_time:=(order_payload->>'time')::timestamptz;
 sale_flavour:=order_payload->'flavour';
 seller:=order_payload->>'sold_by';
 sale_date:=coalesce((order_payload->>'session_date')::date,(sale_time at time zone 'Africa/Johannesburg')::date);
 shift:=nullif(order_payload->>'shift_id','')::uuid;
 if order_id is null or sale_time is null or sale_flavour is null then raise exception 'Incomplete sale'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pos-sale:'||order_id::text,14014));
 if exists(select 1 from private.cancelled_pos_orders c where c.order_id=(order_payload->>'id')::bigint) then return false; end if;
 select * into existing from public.pos_orders where id=order_id;
 if found then
  if (existing.stock_recorded_by is not null and existing.stock_recorded_by<>auth.uid()) or
     existing.flavour is distinct from sale_flavour or existing.type is distinct from order_payload->>'type' or
     existing.payment is distinct from order_payload->>'payment' or existing.price is distinct from (order_payload->>'price')::numeric or
     existing.time is distinct from sale_time or existing.session_date is distinct from sale_date or existing.sold_by is distinct from seller or existing.shift_id is distinct from shift
  then raise exception 'Order ID already used by a different sale' using errcode='23505'; end if;
  return true;
 end if;
 insert into public.pos_orders(id,flavour,type,payment,price,status,time,session_date,sold_by,shift_id,stock_recorded_by)
 values(order_id,sale_flavour,order_payload->>'type',order_payload->>'payment',(order_payload->>'price')::numeric,'active',sale_time,sale_date,seller,shift,auth.uid());
 return true;
end; $$;
revoke all on function public.record_pos_sale(jsonb) from public,anon;
grant execute on function public.record_pos_sale(jsonb) to authenticated;
create or replace function public.cancel_pos_order(order_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  cancelled public.pos_orders%rowtype;
  restoration jsonb;
  deductions jsonb;
begin
  if auth.uid() is null or not private.is_active_pos_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos-sale:'||order_id::text,14014));
  -- The conditional delete locks the row and rechecks status after a competing delivery.
  delete from public.pos_orders where id = order_id and status <> 'delivered'
    returning * into cancelled;
  if not found then return false; end if;
  insert into private.cancelled_pos_orders(order_id, order_data, cancelled_by)
    values (cancelled.id, to_jsonb(cancelled), auth.uid());
  select d.deductions into deductions from private.pos_order_stock_deductions d where d.order_id = cancelled.id;
  delete from private.pos_order_stock_deductions d where d.order_id = cancelled.id;
  perform 1 from public.pos_stock order by id for update;
  for restoration in select value from jsonb_array_elements(coalesce(deductions, '[]'::jsonb)) loop
    if restoration ? 'flavourId' then
      update public.pos_stock s set sub_items = (
        select jsonb_agg(case when item->>'id' = restoration->>'flavourId'
          then jsonb_set(item, '{quantity}', to_jsonb(round((item->>'quantity')::numeric + (restoration->>'quantity')::numeric, 3)))
          else item end order by ord)
        from jsonb_array_elements(s.sub_items) with ordinality a(item, ord)
      ) where s.id = (restoration->>'stockId')::bigint;
    else
      update public.pos_stock set quantity = quantity + (restoration->>'quantity')::numeric
        where id = (restoration->>'stockId')::bigint;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.cancel_pos_order(bigint) from public, anon;
grant execute on function public.cancel_pos_order(bigint) to authenticated;


commit;
