begin;
-- Only names of people referenced by expenses visible to Management.
create or replace function public.get_pos_expense_people()
returns table(id uuid,name text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_pos_permission('management') then
  raise exception 'Management access required' using errcode='42501';
 end if;
 return query select p.id,p.name from public.pos_profiles p
 where exists(select 1 from public.pos_expenses e where p.id in (e.paid_by,e.submitted_by,e.approved_by,e.payment_by));
end; $$;
revoke all on function public.get_pos_expense_people() from public,anon;
grant execute on function public.get_pos_expense_people() to authenticated;
commit;
