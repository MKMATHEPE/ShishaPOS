begin;
create table if not exists public.pos_prices (
 id boolean primary key default true check(id),
 full_price numeric not null check(full_price>=0 and full_price<=1000000 and full_price=round(full_price,2)),
 refill_price numeric not null check(refill_price>=0 and refill_price<=1000000 and refill_price=round(refill_price,2))
);
alter table public.pos_prices enable row level security;
grant select,insert,update on public.pos_prices to authenticated;
create policy prices_read on public.pos_prices for select to authenticated using(exists(select 1 from public.pos_profiles where id=(select auth.uid()) and paused=false));
create policy prices_insert on public.pos_prices for insert to authenticated with check(private.is_pos_admin());
create policy prices_update on public.pos_prices for update to authenticated using(private.is_pos_admin()) with check(private.is_pos_admin());
create or replace function public.save_pos_prices(new_full numeric,new_refill numeric,expected_full numeric,expected_refill numeric)
returns boolean language plpgsql security invoker set search_path='' as $$
declare previous public.pos_prices%rowtype;
begin
 if not private.is_pos_admin() then raise exception 'Only Admins can change prices' using errcode='42501'; end if;
 if new_full is null or new_refill is null or new_full<0 or new_refill<0 or new_full>1000000 or new_refill>1000000 or new_full<>round(new_full,2) or new_refill<>round(new_refill,2) then raise exception 'Enter valid prices with no more than two decimals'; end if;
 lock table public.pos_prices in share row exclusive mode;
 select * into previous from public.pos_prices where id=true;
 if found then
  if previous.full_price is distinct from expected_full or previous.refill_price is distinct from expected_refill then raise exception 'Prices changed. Refresh before saving.'; end if;
  update public.pos_prices set full_price=new_full,refill_price=new_refill where id=true;
 else
  insert into public.pos_prices(id,full_price,refill_price) values(true,new_full,new_refill);
 end if;
 return true;
end $$;
revoke all on function public.save_pos_prices(numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.save_pos_prices(numeric,numeric,numeric,numeric) to authenticated;
commit;
