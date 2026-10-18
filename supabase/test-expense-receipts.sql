-- Rollback-only integration test against the configured POS profiles.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f","role":"authenticated"}',true);
insert into storage.objects(bucket_id,name) values('expense-receipts','1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f/00000000-0000-4000-8000-000000000001.jpg');
insert into public.pos_expenses(id,category,amount,time,stock_quantities,receipt_path) values(9999999999999001,'Transport',1,now(),'{}','1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f/00000000-0000-4000-8000-000000000001.jpg');
do $$ begin if (select count(*) from storage.objects where bucket_id='expense-receipts')<>1 then raise exception 'Owner cannot read receipt'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"9bdb4a6a-8790-4ed0-9b70-469c43634bc4","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from storage.objects where bucket_id='expense-receipts')<>1 then raise exception 'Manager cannot read linked receipt'; end if;
 begin insert into storage.objects(bucket_id,name) values('expense-receipts','1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f/00000000-0000-4000-8000-000000000002.jpg'); raise exception 'Cross-owner upload allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","role":"authenticated"}',true);
do $$ begin if (select count(*) from storage.objects where bucket_id='expense-receipts')<>1 then raise exception 'Admin cannot read linked receipt'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"8f79c21d-775b-4b3b-ba21-4464f681a5d5","role":"authenticated"}',true);
do $$ begin if exists(select 1 from storage.objects where bucket_id='expense-receipts') then raise exception 'Unauthorised staff can read receipt'; end if; end $$;
rollback;
