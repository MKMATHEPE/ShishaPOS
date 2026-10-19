-- Run after applying undo-expense-payment.sql; test writes are rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","role":"authenticated"}',true);
insert into public.pos_expenses(id,category,amount,time,stock_quantities,paid_by) values(9999999999999011,'Transport',70,now(),'{}','1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f');
update public.pos_expenses set approval_status='approved' where id=9999999999999011;
update public.pos_expenses set approval_status='paid' where id=9999999999999011;
select set_config('request.jwt.claims','{"sub":"1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f","role":"authenticated"}',true);
do $$ declare n integer; begin
 begin
  update public.pos_expenses set approval_status='approved' where id=9999999999999011;
  get diagnostics n=row_count;
  if n>0 then raise exception 'Manager reversed payment'; end if;
 exception when insufficient_privilege then null; when raise_exception then if sqlerrm not like 'Only Admins%' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claims','{"sub":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","role":"authenticated"}',true);
update public.pos_expenses set approval_status='approved' where id=9999999999999011;
do $$ begin
 if not exists(select 1 from public.pos_expenses where id=9999999999999011 and approval_status='approved' and payment_at is null and payment_by is null and amount=70) then raise exception 'Undo failed'; end if;
 if exists(select 1 from public.pos_finance_transactions where description='Expense #9999999999999011') then raise exception 'Reimbursement was not reversed'; end if;
end $$;
reset role;
do $$ begin if (select count(*) from private.expense_payment_corrections where expense_id=9999999999999011)<>1 then raise exception 'Correction audit missing'; end if; end $$;
rollback;
