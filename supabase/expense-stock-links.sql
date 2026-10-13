alter table public.pos_expenses add column if not exists description text, add column if not exists paid_by uuid references public.pos_profiles(id), add column if not exists reimbursed_at timestamptz;
alter table public.pos_expenses add column if not exists stock_quantities jsonb not null default '{}';
create or replace function private.apply_expense_stock()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 old_counts jsonb := '{}'; new_counts jsonb := '{}';
 entry record; item public.pos_stock%rowtype; sub jsonb; delta numeric; current_qty numeric; lock_date date;
begin
 if auth.uid() is null or not private.has_pos_permission('management') then raise exception 'Management permission required' using errcode='42501'; end if;
 if tg_op<>'INSERT' then old_counts:=old.stock_quantities; end if;
 if tg_op<>'DELETE' then new_counts:=new.stock_quantities; end if;
 select locked_through into lock_date from public.pos_finance_settings where id=true;
 if lock_date is not null and ((tg_op<>'INSERT' and (old.time at time zone 'Africa/Johannesburg')::date <= lock_date) or (tg_op<>'DELETE' and (new.time at time zone 'Africa/Johannesburg')::date <= lock_date)) then raise exception 'This accounting period is locked'; end if;
 if jsonb_typeof(new_counts)<>'object' then raise exception 'Invalid stock purchase'; end if;
 for entry in select * from jsonb_each(new_counts) loop
   if jsonb_typeof(entry.value)<>'number' or (entry.value::text)::numeric<=0 or (entry.value::text)::numeric>10000000 then raise exception 'Enter a positive stock quantity'; end if;
 end loop;
 -- Lock stock rows in one order so expense changes cannot partially update inventory.
 perform 1 from public.pos_stock order by id for update;
 for entry in select key from jsonb_object_keys(old_counts || new_counts) a(key) loop
   delta:=coalesce((new_counts->>entry.key)::numeric,0)-coalesce((old_counts->>entry.key)::numeric,0);
   if delta=0 then continue; end if;
   select * into item from public.pos_stock where id=split_part(entry.key,':',1)::bigint;
   if not found then raise exception 'Stock item no longer exists'; end if;
   if position(':' in entry.key)>0 then
     select value into sub from jsonb_array_elements(item.sub_items) where value->>'id'=split_part(entry.key,':',2);
     if sub is null then raise exception 'Flavour no longer exists'; end if;
     current_qty:=(sub->>'quantity')::numeric;
     if current_qty+delta<0 then raise exception 'Cannot reverse stock already used. Correct the quantity before changing this purchase.'; end if;
     update public.pos_stock s set sub_items=(select jsonb_agg(case when value->>'id'=split_part(entry.key,':',2) then jsonb_set(value,'{quantity}',to_jsonb(round(current_qty+delta,3))) else value end order by ord) from jsonb_array_elements(s.sub_items) with ordinality a(value,ord)) where id=item.id;
   else
     if item.sub_items is not null then raise exception 'Choose an individual flavour'; end if;
     if item.quantity+delta<0 then raise exception 'Cannot reverse stock already used.'; end if;
     update public.pos_stock set quantity=quantity+delta where id=item.id;
   end if;
 end loop;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function private.apply_expense_stock() from public,anon,authenticated;
create trigger expense_stock_link before insert or update or delete on public.pos_expenses for each row execute function private.apply_expense_stock();
