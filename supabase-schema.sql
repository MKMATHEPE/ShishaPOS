-- Secure Supabase schema for The Chill Pipe POS.
create schema if not exists private;

create table if not exists public.pos_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null, username text, name text not null,
  role text not null default 'Staff' check (role in ('Staff', 'Manager', 'Admin')),
  permissions jsonb not null default '{}'::jsonb,
  paused boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.pos_profiles add column if not exists username text;
update public.pos_profiles
set username = lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g'))
where username is null;
alter table public.pos_profiles alter column username set not null;
alter table public.pos_profiles drop constraint if exists pos_profiles_username_format;
alter table public.pos_profiles add constraint pos_profiles_username_format
  check (username ~ '^[a-z0-9._-]{3,32}$');
create unique index if not exists pos_profiles_username_lower_key
  on public.pos_profiles (lower(username));

create table if not exists public.pos_stock (
  id bigint primary key, name text not null, category text not null,
  quantity numeric not null default 0, unit text not null default 'units',
  low_threshold numeric not null default 0, sub_items jsonb, created_at timestamptz default now()
);

create table if not exists public.pos_orders (
  id bigint primary key, flavour jsonb not null, type text not null,
  payment text not null, price numeric not null, status text not null default 'active',
  time timestamptz not null, delivered_at timestamptz,
  session_date date not null default current_date, sold_by text,
  pipe_returned boolean not null default false, created_at timestamptz default now()
);

create table if not exists public.pos_expenses (
  id bigint primary key, category text not null, qty numeric,
  amount numeric not null, time timestamptz not null, created_at timestamptz default now()
);

create or replace function private.is_active_pos_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pos_profiles where id = (select auth.uid()) and paused = false);
$$;
create or replace function private.is_pos_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pos_profiles where id = (select auth.uid()) and role = 'Admin' and paused = false);
$$;
create or replace function private.has_pos_permission(permission_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pos_profiles where id = (select auth.uid()) and paused = false
      and (role = 'Admin' or coalesce((permissions ->> permission_name)::boolean, false))
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_active_pos_user() from public, anon;
revoke all on function private.is_pos_admin() from public, anon;
revoke all on function private.has_pos_permission(text) from public, anon;
grant execute on function private.is_active_pos_user() to authenticated;
grant execute on function private.is_pos_admin() to authenticated;
grant execute on function private.has_pos_permission(text) to authenticated;

alter table public.pos_profiles enable row level security;
alter table public.pos_stock enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_expenses enable row level security;

-- Remove policies from the retired browser-PIN setup before creating the secure set.
drop policy if exists "deny anon expenses" on public.pos_expenses;
drop policy if exists "pos_expenses all" on public.pos_expenses;
drop policy if exists "anon read orders" on public.pos_orders;
drop policy if exists "pos_orders all" on public.pos_orders;
drop policy if exists "anon read stock" on public.pos_stock;
drop policy if exists "pos_stock all" on public.pos_stock;

drop policy if exists profiles_read on public.pos_profiles;
create policy profiles_read on public.pos_profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_pos_admin()));
drop policy if exists profiles_admin_update on public.pos_profiles;
create policy profiles_admin_update on public.pos_profiles for update to authenticated
  using ((select private.is_pos_admin())) with check ((select private.is_pos_admin()));

drop policy if exists orders_read on public.pos_orders;
create policy orders_read on public.pos_orders for select to authenticated using ((select private.is_active_pos_user()));
drop policy if exists orders_insert on public.pos_orders;
create policy orders_insert on public.pos_orders for insert to authenticated with check ((select private.is_active_pos_user()));
drop policy if exists orders_update on public.pos_orders;
create policy orders_update on public.pos_orders for update to authenticated
  using ((select private.is_active_pos_user())) with check ((select private.is_active_pos_user()));
drop policy if exists orders_delete on public.pos_orders;
create policy orders_delete on public.pos_orders for delete to authenticated using ((select private.is_active_pos_user()));

drop policy if exists stock_read on public.pos_stock;
create policy stock_read on public.pos_stock for select to authenticated using ((select private.is_active_pos_user()));
drop policy if exists stock_write on public.pos_stock;
create policy stock_write on public.pos_stock for all to authenticated
  using ((select private.has_pos_permission('stock'))) with check ((select private.has_pos_permission('stock')));

drop policy if exists expenses_access on public.pos_expenses;
create policy expenses_access on public.pos_expenses for all to authenticated
  using ((select private.has_pos_permission('management'))) with check ((select private.has_pos_permission('management')));

revoke all on public.pos_profiles, public.pos_stock, public.pos_orders, public.pos_expenses from anon;
grant select on public.pos_profiles to authenticated;
grant update (name, role, permissions, paused) on public.pos_profiles to authenticated;
grant select, insert, update, delete on public.pos_stock, public.pos_orders, public.pos_expenses to authenticated;

-- Lock the legacy PIN table if it exists.
do $$ begin
  if to_regclass('public.pos_users') is not null then
    execute 'alter table public.pos_users enable row level security';
    execute 'revoke all on public.pos_users from anon, authenticated';
    execute 'drop policy if exists "deny anon users" on public.pos_users';
    execute 'drop policy if exists "pos_users all" on public.pos_users';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Bootstrap the first Admin after creating them in Authentication > Users:
-- insert into public.pos_profiles (id, email, username, name, role, permissions)
-- select id, email, split_part(email, '@', 1), 'Admin', 'Admin', '{"delivered":true,"stock":true,"management":true,"settings":true}'::jsonb
-- from auth.users where email = 'owner@example.com';
