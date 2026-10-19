begin;
create table public.pos_review_tracking (
 id boolean primary key default true check(id), started_at timestamptz not null default clock_timestamp()
);
insert into public.pos_review_tracking(id) values(true);
alter table public.pos_review_tracking enable row level security;
revoke all on public.pos_review_tracking from anon,authenticated;
grant select on public.pos_review_tracking to authenticated;
create policy review_tracking_read on public.pos_review_tracking for select to authenticated using((select private.is_pos_admin()));

create table public.pos_review_stock_movements (
 id uuid primary key default gen_random_uuid(),
 recorded_at timestamptz not null default clock_timestamp(),
 expense_id bigint not null,
 quantities jsonb not null check(jsonb_typeof(quantities)='object')
);
create index review_movements_time on public.pos_review_stock_movements(recorded_at);
alter table public.pos_review_stock_movements enable row level security;
revoke all on public.pos_review_stock_movements from anon,authenticated;
grant select on public.pos_review_stock_movements to authenticated;
create policy review_movements_read on public.pos_review_stock_movements for select to authenticated using((select private.is_pos_admin()));

-- Private trigger: append stock deltas in the same transaction as the expense.
create function private.track_review_expense_stock() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_counts jsonb:='{}'; new_counts jsonb:='{}'; delta_counts jsonb;
begin
 if tg_op<>'INSERT' then old_counts:=old.stock_quantities; end if;
 if tg_op<>'DELETE' then new_counts:=new.stock_quantities; end if;
 select coalesce(jsonb_object_agg(key,delta),'{}') into delta_counts from (
  select key,coalesce((new_counts->>key)::numeric,0)-coalesce((old_counts->>key)::numeric,0) delta
  from jsonb_object_keys(old_counts||new_counts) k(key)
 ) d where delta<>0;
 if delta_counts<>'{}' then
  insert into public.pos_review_stock_movements(expense_id,quantities) values(case when tg_op='DELETE' then old.id else new.id end,delta_counts);
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function private.track_review_expense_stock() from public,anon,authenticated;
create trigger review_expense_stock after insert or update or delete on public.pos_expenses for each row execute function private.track_review_expense_stock();

create table public.pos_shift_reviews (
 id uuid primary key,
 start_count uuid not null references public.pos_stocktakes(id),
 end_count uuid not null references public.pos_stocktakes(id),
 actual_cash numeric check(actual_cash>=0 and actual_cash<=100000000 and actual_cash=round(actual_cash,2)),
 actual_card numeric check(actual_card>=0 and actual_card<=100000000 and actual_card=round(actual_card,2)),
 coal_confirmed boolean not null default false,
 explanation text not null default '' check(length(explanation)<=1000),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=100000),
 reviewed_by uuid not null default auth.uid() references public.pos_profiles(id),
 created_at timestamptz not null default now(),
 check(start_count<>end_count)
);
create index shift_reviews_created on public.pos_shift_reviews(created_at desc);
alter table public.pos_shift_reviews enable row level security;
revoke all on public.pos_shift_reviews from anon,authenticated;
grant select,insert on public.pos_shift_reviews to authenticated;
create policy shift_reviews_read on public.pos_shift_reviews for select to authenticated using((select private.is_pos_admin()));
create policy shift_reviews_insert on public.pos_shift_reviews for insert to authenticated with check(
 (select private.is_pos_admin()) and reviewed_by=(select auth.uid())
 and exists(select 1 from public.pos_stocktakes a join public.pos_stocktakes b on b.id=end_count
 where a.id=start_count and a.status='closed' and b.status='closed' and a.closed_at<b.closed_at)
);
commit;
