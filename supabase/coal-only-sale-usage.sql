begin;
create or replace function private.deduct_pos_sale_stock()
returns trigger language plpgsql security definer set search_path='' as $$
declare item public.pos_stock%rowtype; coal_rows integer:=0; deductions jsonb:='[]'::jsonb; flavour_name text;
begin
 if not private.is_active_pos_user() or new.stock_recorded_by is distinct from auth.uid() then raise exception 'Active POS user required' using errcode='42501'; end if;
 if new.type is null or new.payment is null or new.type not in ('full','refill') or new.payment not in ('cash','card') or new.price is null or new.price<0 or new.status is distinct from 'active' or new.pipe_returned is distinct from false or new.delivered_at is not null then raise exception 'Invalid sale'; end if;
 flavour_name:=case when jsonb_typeof(new.flavour)='object' then new.flavour->>'name' when jsonb_typeof(new.flavour)='string' then new.flavour#>>'{}' else null end;
 -- Match the common lock order used by purchases, counts and cancellations.
 perform 1 from public.pos_stock order by id for update;
 if not exists(select 1 from public.pos_stock s,jsonb_array_elements(s.sub_items) f where s.name='Flavour' and f->>'name'=flavour_name) then raise exception 'Unknown flavour'; end if;
 for item in select * from public.pos_stock where name='Coal' and category='consumable' loop
  coal_rows:=coal_rows+1;
  update public.pos_stock set quantity=greatest(0,quantity-2) where id=item.id;
  deductions:=deductions||jsonb_build_array(jsonb_build_object('stockId',item.id,'quantity',least(greatest(item.quantity,0),2)));
 end loop;
 if coal_rows<>1 then raise exception 'Coal inventory is incomplete'; end if;
 insert into private.pos_order_stock_deductions(order_id,deductions) values(new.id,deductions);
 return new;
end; $$;
revoke all on function private.deduct_pos_sale_stock() from public,anon,authenticated;
commit;
