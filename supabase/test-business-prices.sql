-- Rollback-only checks; apply business-prices.sql before running on a fresh prices table.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","role":"authenticated"}',true);
select public.save_pos_prices(175,120,170,120);
do $$ begin
 if not exists(select 1 from public.pos_prices where full_price=175 and refill_price=120) then raise exception 'Prices did not persist'; end if;
 begin perform public.save_pos_prices(180,120,170,120);raise exception 'Stale overwrite allowed';exception when raise_exception then if sqlerrm not like 'Prices changed%' then raise;end if;end;
 begin perform public.save_pos_prices(175.001,120,175,120);raise exception 'Fractional cents allowed';exception when raise_exception then if sqlerrm not like 'Enter valid prices%' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f","role":"authenticated"}',true);
do $$ begin
 if not exists(select 1 from public.pos_prices where full_price=175 and refill_price=120) then raise exception 'Manager cannot read prices';end if;
 begin perform public.save_pos_prices(100,100,175,120);raise exception 'Manager changed prices';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"8f79c21d-775b-4b3b-ba21-4464f681a5d5","role":"authenticated"}',true);
do $$ begin if not exists(select 1 from public.pos_prices where full_price=175) then raise exception 'Staff cannot read prices';end if;end $$;
select set_config('request.jwt.claims','{"sub":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","role":"authenticated"}',true);
select public.save_pos_prices(180,125,175,120);
do $$ begin if not exists(select 1 from public.pos_prices where full_price=180 and refill_price=125) then raise exception 'Second price save failed';end if;end $$;
rollback;
