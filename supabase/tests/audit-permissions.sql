begin;
do $$
declare profile record; affected integer; allowed boolean; test_date date; tests integer:=0;
begin
 select greatest(current_date,coalesce(locked_through+1,current_date)) into test_date from public.pos_finance_settings where id=true;
 for profile in select distinct on (role) id,role from public.pos_profiles where paused=false order by role,id loop
  perform set_config('request.jwt.claim.sub',profile.id::text,true);
  execute 'set local role authenticated';
  allowed:=private.is_pos_admin();
  update public.pos_orders set price=price where id=(select min(id) from public.pos_orders);
  get diagnostics affected=row_count;
  if not allowed and affected<>0 then raise exception 'Non-admin updated order'; end if;
  begin
   insert into public.pos_manual_sales(sale_date,amount,payment,description,reason) values(test_date,1,'cash','permission-test','rollback-only');
   if not allowed then raise exception 'Non-admin inserted manual sale'; end if;
  exception when insufficient_privilege then if allowed then raise exception 'Admin could not insert manual sale'; end if; end;
  begin
   insert into public.pos_finance_transactions(kind,profile_id,amount,transaction_date) values('reimbursement',profile.id,1,test_date);
   if not allowed then raise exception 'Non-admin inserted payout'; end if;
  exception when insufficient_privilege then if allowed then raise exception 'Admin could not insert payout'; end if; end;
  update public.pos_finance_settings set updated_at=updated_at where id=true;
  get diagnostics affected=row_count;
  if (allowed and affected<>1) or (not allowed and affected<>0) then raise exception 'Finance settings policy mismatch'; end if;
  perform public.record_pos_diagnostic('error','app','runtime_error',1);
  if not allowed and exists(select 1 from public.pos_diagnostics) then raise exception 'Non-admin read diagnostics'; end if;
  execute 'reset role';tests:=tests+1;
 end loop;
 if tests<2 then raise exception 'Not enough roles available to verify'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 execute 'set local role anon';
 begin
  perform public.record_pos_diagnostic('error','app','runtime_error',1);
  raise exception 'Anonymous diagnostic write allowed';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
end $$;
rollback;
select 'PASS: active-role permissions and anonymous diagnostic denial; all test writes rolled back' as result;
