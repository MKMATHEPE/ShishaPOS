begin;
create or replace function public.configure_pos_profit_partners(partners jsonb, expected_partners jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_partners jsonb; expected jsonb; entry jsonb; total numeric:=0;
begin
 if not private.is_pos_admin() then raise exception 'Only Admins can configure profit partners' using errcode='42501'; end if;
 if jsonb_typeof(partners)<>'array' or jsonb_array_length(partners)=0 or jsonb_array_length(partners)>100 then raise exception 'Choose at least one partner'; end if;
 if jsonb_typeof(expected_partners)<>'array' then raise exception 'Refresh partner settings before saving'; end if;
 for entry in select value from jsonb_array_elements(partners) loop
  if jsonb_typeof(entry->'profitShare') is distinct from 'number' or (entry->>'profitShare')::numeric<=0 or (entry->>'profitShare')::numeric>100 then raise exception 'Enter a percentage greater than 0 and no more than 100'; end if;
  if not exists(select 1 from public.pos_profiles where id=(entry->>'profileId')::uuid) then raise exception 'Partner account no longer exists'; end if;
  total:=total+(entry->>'profitShare')::numeric;
 end loop;
 if total<>100 then raise exception 'Partner percentages must total 100%%'; end if;
 if (select count(distinct value->>'profileId') from jsonb_array_elements(partners))<>jsonb_array_length(partners) then raise exception 'Choose each partner only once'; end if;
 lock table public.pos_finance_partners in share row exclusive mode;
 select coalesce(jsonb_agg(jsonb_build_object('profileId',profile_id,'profitShare',profit_share) order by profile_id::text),'[]'::jsonb) into current_partners from public.pos_finance_partners;
 select coalesce(jsonb_agg(value order by value->>'profileId'),'[]'::jsonb) into expected from jsonb_array_elements(expected_partners);
 if current_partners is distinct from expected then raise exception 'Partner settings changed. Refresh before saving.'; end if;
 delete from public.pos_finance_partners where profile_id is not null;
 insert into public.pos_finance_partners(profile_id,profit_share) select (value->>'profileId')::uuid,(value->>'profitShare')::numeric from jsonb_array_elements(partners);
 return true;
end $$;
revoke all on function public.configure_pos_profit_partners(jsonb,jsonb) from public,anon;
grant execute on function public.configure_pos_profit_partners(jsonb,jsonb) to authenticated;
commit;
