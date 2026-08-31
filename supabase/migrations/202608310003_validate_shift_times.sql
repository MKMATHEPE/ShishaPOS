create or replace function private.validate_pos_shift_times()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.opened_at > now() then
    raise exception 'Shift start time cannot be in the future';
  end if;

  if tg_op = 'INSERT' and exists (
    select 1 from public.pos_shifts
    where status = 'closed' and closed_at > new.opened_at
  ) then
    raise exception 'Shift must start after the most recently closed shift';
  end if;

  if new.closed_at is not null and new.closed_at < new.opened_at then
    raise exception 'Shift close time cannot be before its start time';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_pos_shift_times() from public, anon;
grant execute on function private.validate_pos_shift_times() to authenticated;

drop trigger if exists validate_pos_shift_times on public.pos_shifts;
create trigger validate_pos_shift_times
before insert or update on public.pos_shifts
for each row execute function private.validate_pos_shift_times();
