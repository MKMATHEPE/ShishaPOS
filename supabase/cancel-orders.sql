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
  -- The conditional delete locks the row and rechecks status after a competing delivery.
  delete from public.pos_orders where id = order_id and status <> 'delivered'
    returning * into cancelled;
  if not found then return false; end if;
  insert into private.cancelled_pos_orders(order_id, order_data, cancelled_by)
    values (cancelled.id, to_jsonb(cancelled), auth.uid());
  select d.deductions into deductions from private.pos_order_stock_deductions d where d.order_id = cancelled.id;
  delete from private.pos_order_stock_deductions d where d.order_id = cancelled.id;
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

-- Record actual, clamped deductions on the server, once per order.
create or replace function public.insert_pos_order(order_data jsonb, consume_stock boolean default true)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
  item public.pos_stock%rowtype;
  sub jsonb;
  used numeric;
  serving numeric;
  deductions jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not private.is_active_pos_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from private.cancelled_pos_orders where order_id=(order_data->>'id')::bigint) then return false; end if;
  if order_data->>'status' <> 'active' then raise exception 'New order must be active'; end if;
  insert into public.pos_orders(id, flavour, type, payment, price, status, time, session_date, sold_by, shift_id)
  values ((order_data->>'id')::bigint, order_data->>'flavour', order_data->>'type', order_data->>'payment',
    (order_data->>'price')::numeric, 'active', (order_data->>'time')::timestamptz,
    (order_data->>'session_date')::date, order_data->>'sold_by', (order_data->>'shift_id')::uuid)
  on conflict (id) do nothing returning id into new_id;
  if not found then return true; end if;
  if consume_stock then
    for item in select * from public.pos_stock where name in ('Coal', 'Mouth Pieces', 'Flavour') order by id for update loop
      if item.name = 'Flavour' then
        for sub in select value from jsonb_array_elements(item.sub_items) loop
          if sub->>'name' = order_data->>'flavour' then
            serving := case when sub->>'id' in ('mc','gm') then 0.25 else 1.0/3.5 end;
            used := least(greatest((sub->>'quantity')::numeric,0), serving);
            used := (sub->>'quantity')::numeric - round((sub->>'quantity')::numeric - used,3);
            update public.pos_stock s set sub_items = (
              select jsonb_agg(case when value->>'id' = sub->>'id'
                then jsonb_set(value,'{quantity}',to_jsonb(round((value->>'quantity')::numeric-used,3))) else value end order by ord)
              from jsonb_array_elements(s.sub_items) with ordinality a(value,ord)
            ) where s.id=item.id;
            deductions := deductions || jsonb_build_array(jsonb_build_object('stockId',item.id,'flavourId',sub->>'id','quantity',used));
          end if;
        end loop;
      else
        used := least(greatest(item.quantity,0),2);
        update public.pos_stock set quantity=quantity-used where id=item.id;
        deductions := deductions || jsonb_build_array(jsonb_build_object('stockId',item.id,'quantity',used));
      end if;
    end loop;
  end if;
  insert into private.pos_order_stock_deductions(order_id,deductions) values (new_id,deductions);
  return true;
end;
$$;
revoke all on function public.insert_pos_order(jsonb, boolean) from public, anon;
grant execute on function public.insert_pos_order(jsonb, boolean) to authenticated;
