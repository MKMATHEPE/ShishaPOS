create table if not exists public.pos_stocktakes (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references public.pos_profiles(id),
  opening jsonb not null,
  additions jsonb not null default '[]',
  expected jsonb,
  closing jsonb,
  closed_at timestamptz,
  closed_by uuid references public.pos_profiles(id),
  note text not null default '',
  check ((status='open' and closed_at is null and closing is null) or
         (status='closed' and closed_at is not null and closing is not null and expected is not null and closed_by is not null))
);
create unique index if not exists pos_stocktakes_one_open on public.pos_stocktakes(status) where status='open';
alter table public.pos_stocktakes enable row level security;
revoke all on public.pos_stocktakes from anon, authenticated;
grant select on public.pos_stocktakes to authenticated;
create policy stocktakes_read on public.pos_stocktakes for select to authenticated
  using ((select private.has_pos_permission('stock')));

create table if not exists public.pos_stock_receipts (
 id uuid primary key default gen_random_uuid(),
 recorded_at timestamptz not null default now(),
 recorded_by uuid not null references public.pos_profiles(id),
 stocktake_id uuid references public.pos_stocktakes(id),
 counts jsonb not null,
 kind text not null default 'add' check (kind in ('add','adjust')),
 before_counts jsonb not null default '{}'
);
alter table public.pos_stock_receipts enable row level security;
revoke all on public.pos_stock_receipts from anon, authenticated;
grant select on public.pos_stock_receipts to authenticated;
create policy stock_receipts_read on public.pos_stock_receipts for select to authenticated using ((select private.has_pos_permission('stock')));

create or replace function public.record_pos_stocktake(action text, counts jsonb, expected_counts jsonb default null, closing_note text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare
  session public.pos_stocktakes%rowtype;
  item public.pos_stock%rowtype;
  snapshot jsonb := '{}';
  part jsonb;
  key text;
  amount numeric;
  result_id uuid;
begin
  if auth.uid() is null or not private.has_pos_permission('stock') then
    raise exception 'Stock permission required' using errcode='42501';
  end if;
  if action not in ('open','add','adjust','close','count') then raise exception 'Unknown action'; end if;
  if jsonb_typeof(counts) <> 'object' or counts='{}'::jsonb then raise exception 'Enter stock quantities'; end if;
  perform pg_advisory_xact_lock(49387122);
  select * into session from public.pos_stocktakes where status='open' for update;
  if action='open' and session.id is not null then raise exception 'A stock shift is already open'; end if;
  if action='close' and session.id is null then raise exception 'Open a stock shift first'; end if;
  for item in select * from public.pos_stock order by id for update loop
    if item.sub_items is not null then
      for part in select value from jsonb_array_elements(item.sub_items) loop
        snapshot := snapshot || jsonb_build_object(item.id::text || ':' || (part->>'id'), (part->>'quantity')::numeric);
      end loop;
    else
      snapshot := snapshot || jsonb_build_object(item.id::text, item.quantity);
    end if;
  end loop;
  if action in ('open','close','adjust','count') and snapshot is distinct from expected_counts then
    raise exception 'Stock changed while counting. Refresh and review the differences before confirming.';
  end if;
  if action in ('open','close','count') and
     ((select count(*) from jsonb_object_keys(counts)) <> (select count(*) from jsonb_object_keys(snapshot))) then
    raise exception 'Count every stock item';
  end if;
  for key, part in select * from jsonb_each(counts) loop
    if not snapshot ? key or jsonb_typeof(part)<>'number' then raise exception 'Invalid stock count'; end if;
    amount := part::text::numeric;
    if amount < 0 or amount > 10000000 then raise exception 'Stock must be a valid non-negative quantity'; end if;
  end loop;
  for item in select * from public.pos_stock order by id loop
    if item.sub_items is not null then
      update public.pos_stock set sub_items=(
        select jsonb_agg(case when counts ? (item.id::text || ':' || (value->>'id')) then
          jsonb_set(value,'{quantity}',to_jsonb(
            case when action='add' then (value->>'quantity')::numeric else 0 end +
            (counts->>(item.id::text || ':' || (value->>'id')))::numeric)) else value end order by ord)
        from jsonb_array_elements(item.sub_items) with ordinality a(value,ord)
      ) where id=item.id;
    elsif counts ? item.id::text then
      update public.pos_stock set quantity=case when action='add' then quantity else 0 end +
        (counts->>item.id::text)::numeric where id=item.id;
    end if;
  end loop;
  if action='open' then
    insert into public.pos_stocktakes(status,opened_by,opening) values ('open',auth.uid(),counts) returning id into result_id;
  elsif action in ('add','adjust') then
    insert into public.pos_stock_receipts(recorded_by,stocktake_id,counts,kind,before_counts) values (auth.uid(),session.id,counts,action,snapshot) returning id into result_id;
    if session.id is not null and action='add' then
      update public.pos_stocktakes set additions=additions || jsonb_build_array(jsonb_build_object('time',now(),'by',auth.uid(),'counts',counts)) where id=session.id;
    end if;
  elsif action='count' and session.id is null then
    insert into public.pos_stocktakes(status,opened_by,opening,expected,closing,closed_at,closed_by,note) values ('closed',auth.uid(),snapshot,snapshot,counts,now(),auth.uid(),left(closing_note,1000)) returning id into result_id;
  else
    update public.pos_stocktakes set status='closed',expected=snapshot,closing=counts,closed_at=now(),closed_by=auth.uid(),note=left(closing_note,1000)
      where id=session.id returning id into result_id;
  end if;
  return result_id;
end;
$$;
revoke all on function public.record_pos_stocktake(text,jsonb,jsonb,text) from public,anon;
grant execute on function public.record_pos_stocktake(text,jsonb,jsonb,text) to authenticated;
