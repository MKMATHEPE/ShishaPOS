create index if not exists pos_shifts_opened_by_idx on public.pos_shifts (opened_by);
create index if not exists pos_shifts_closed_by_idx on public.pos_shifts (closed_by);
