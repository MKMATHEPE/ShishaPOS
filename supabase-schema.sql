-- Run this in your Supabase project: SQL Editor → New Query → Paste → Run

-- Users
create table if not exists pos_users (
  id bigint primary key,
  name text not null,
  role text not null default 'Staff',
  pin text not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Stock (sub_items stored as JSON for flavour sub-items)
create table if not exists pos_stock (
  id bigint primary key,
  name text not null,
  category text not null,
  quantity numeric not null default 0,
  unit text not null default 'units',
  low_threshold numeric not null default 0,
  sub_items jsonb,
  created_at timestamptz default now()
);

-- Orders (today's orders loaded on startup)
create table if not exists pos_orders (
  id bigint primary key,
  flavour jsonb not null,
  type text not null,
  payment text not null,
  price numeric not null,
  status text not null default 'active',
  time timestamptz not null,
  delivered_at timestamptz,
  session_date date not null default current_date,
  sold_by text,
  created_at timestamptz default now()
);

-- Migration: add sold_by to existing pos_orders table
-- alter table pos_orders add column if not exists sold_by text;

-- Expenses
create table if not exists pos_expenses (
  id bigint primary key,
  category text not null,
  qty numeric,
  amount numeric not null,
  time timestamptz not null,
  created_at timestamptz default now()
);

-- Disable Row Level Security (safe for a private local POS)
alter table pos_users    disable row level security;
alter table pos_stock    disable row level security;
alter table pos_orders   disable row level security;
alter table pos_expenses disable row level security;
