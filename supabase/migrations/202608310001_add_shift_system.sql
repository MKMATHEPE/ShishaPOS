create table if not exists public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references public.pos_profiles(id),
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  closed_at timestamptz,
  closed_by uuid references public.pos_profiles(id),
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  cash_difference numeric(12,2),
  closing_note text,
  created_at timestamptz not null default now(),
  constraint pos_shifts_closed_fields check (
    (status = 'open' and closed_at is null and closed_by is null)
    or
    (status = 'closed' and closed_at is not null and closed_by is not null and expected_cash is not null and counted_cash is not null and cash_difference is not null)
  )
);

create unique index if not exists pos_shifts_one_open_idx on public.pos_shifts (status) where status = 'open';
create index if not exists pos_shifts_opened_at_idx on public.pos_shifts (opened_at desc);

alter table public.pos_orders add column if not exists shift_id uuid references public.pos_shifts(id);
alter table public.pos_expenses add column if not exists shift_id uuid references public.pos_shifts(id);
create index if not exists pos_orders_shift_id_idx on public.pos_orders (shift_id);
create index if not exists pos_expenses_shift_id_idx on public.pos_expenses (shift_id);

alter table public.pos_shifts enable row level security;

drop policy if exists shifts_read on public.pos_shifts;
create policy shifts_read on public.pos_shifts for select to authenticated
  using ((select private.is_active_pos_user()));

drop policy if exists shifts_insert_management on public.pos_shifts;
create policy shifts_insert_management on public.pos_shifts for insert to authenticated
  with check (
    opened_by = (select auth.uid())
    and exists (
      select 1 from public.pos_profiles
      where id = (select auth.uid()) and paused = false and role in ('Manager', 'Admin')
    )
  );

drop policy if exists shifts_update_management on public.pos_shifts;
create policy shifts_update_management on public.pos_shifts for update to authenticated
  using (
    exists (
      select 1 from public.pos_profiles
      where id = (select auth.uid()) and paused = false and role in ('Manager', 'Admin')
    )
  )
  with check (
    exists (
      select 1 from public.pos_profiles
      where id = (select auth.uid()) and paused = false and role in ('Manager', 'Admin')
    )
  );

revoke all on public.pos_shifts from anon;
grant select, insert, update on public.pos_shifts to authenticated;
notify pgrst, 'reload schema';
