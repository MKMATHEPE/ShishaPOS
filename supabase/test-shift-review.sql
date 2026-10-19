-- Rollback-only: no review, expense or stock changes survive this test.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","role":"authenticated"}',true);
do $$
declare test_opening_id uuid;test_closing_id uuid; before_count int; movement jsonb;
begin
 select id into test_closing_id from public.pos_stocktakes where status='closed' order by closed_at desc limit 1;
 select id into test_opening_id from public.pos_stocktakes where status='closed' and id<>test_closing_id order by closed_at desc limit 1;
 insert into public.pos_shift_reviews(id,start_count,end_count,actual_cash,snapshot)
 values('00000000-0000-4000-8000-000000000001',test_opening_id,test_closing_id,0,'{}');
 -- Retry-safe insert must not need UPDATE permission.
 insert into public.pos_shift_reviews(id,start_count,end_count,actual_cash,snapshot)
 values('00000000-0000-4000-8000-000000000001',test_opening_id,test_closing_id,0,'{}') on conflict(id) do nothing;
 if (select count(*) from public.pos_shift_reviews where id='00000000-0000-4000-8000-000000000001')<>1 then raise exception 'Duplicate review';end if;
 begin
  insert into public.pos_shift_reviews(id,start_count,end_count,snapshot) values(gen_random_uuid(),test_closing_id,test_opening_id,'{}');
  raise exception 'Reversed interval allowed';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.pos_shift_reviews(id,start_count,end_count,actual_cash,snapshot) values(gen_random_uuid(),test_opening_id,test_closing_id,-1,'{}');
  raise exception 'Negative actual allowed';
 exception when check_violation then null;end;
 begin update public.pos_shift_reviews set actual_cash=100 where id='00000000-0000-4000-8000-000000000001';raise exception 'Review overwritten';exception when insufficient_privilege then null;end;
 begin delete from public.pos_shift_reviews where id='00000000-0000-4000-8000-000000000001';raise exception 'Review deleted';exception when insufficient_privilege then null;end;
 select count(*) into before_count from public.pos_review_stock_movements;
 insert into public.pos_expenses(id,category,amount,time,description,stock_quantities,submitted_by,paid_by)
 values(-987654321,'Supplies',1,now(),'Rollback-only review test','{"14:lk":0.1}',auth.uid(),auth.uid());
 if (select count(*) from public.pos_review_stock_movements)<>before_count+1 then raise exception 'Purchase not tracked';end if;
 update public.pos_expenses set stock_quantities='{"14:lk":0.2}' where id=-987654321;
 select quantities into movement from public.pos_review_stock_movements where expense_id=-987654321 order by recorded_at desc limit 1;
 if movement<>'{"14:lk":0.1}' then raise exception 'Edit delta incorrect: %',movement;end if;
 delete from public.pos_expenses where id=-987654321;
 select quantities into movement from public.pos_review_stock_movements where expense_id=-987654321 order by recorded_at desc limit 1;
 if movement<>'{"14:lk":-0.2}' then raise exception 'Reversal delta incorrect';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.pos_shift_reviews) or exists(select 1 from public.pos_review_tracking) or exists(select 1 from public.pos_review_stock_movements) then raise exception 'Manager can read Admin reviews';end if;
 begin insert into public.pos_shift_reviews(id,start_count,end_count,snapshot) select gen_random_uuid(),a.id,b.id,'{}' from public.pos_stocktakes a join public.pos_stocktakes b on a.closed_at<b.closed_at limit 1;raise exception 'Manager inserted review';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"8f79c21d-775b-4b3b-ba21-4464f681a5d5","role":"authenticated"}',true);
do $$ begin if exists(select 1 from public.pos_shift_reviews) or exists(select 1 from public.pos_review_tracking) or exists(select 1 from public.pos_review_stock_movements) then raise exception 'Staff can read Admin reviews';end if;end $$;
set local role anon;
do $$ begin begin perform 1 from public.pos_shift_reviews;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;end $$;
rollback;
