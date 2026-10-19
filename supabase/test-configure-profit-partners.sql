-- Rollback-only permission, validation, atomic-save and stale-state checks.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","role":"authenticated"}',true);
do $$ declare previous jsonb; result jsonb; begin
 select coalesce(jsonb_agg(jsonb_build_object('profileId',profile_id,'profitShare',profit_share)),'[]'::jsonb) into previous from public.pos_finance_partners;
 perform public.configure_pos_profit_partners('[{"profileId":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","profitShare":100}]',previous);
 if (select count(*) from public.pos_finance_partners)<>1 or not exists(select 1 from public.pos_finance_partners where profile_id='b6c7465a-0d19-45f9-9650-10cd76c6a9db' and profit_share=100) then raise exception 'Partner save failed'; end if;
 begin
  perform public.configure_pos_profit_partners('[{"profileId":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","profitShare":95}]','[]');
  raise exception 'Invalid total allowed';
 exception when raise_exception then if sqlerrm not like 'Partner percentages%' then raise; end if; end;
 begin
  perform public.configure_pos_profit_partners('[{"profileId":"b6c7465a-0d19-45f9-9650-10cd76c6a9db","profitShare":100}]','[]');
  raise exception 'Stale save allowed';
 exception when raise_exception then if sqlerrm not like 'Partner settings changed%' then raise; end if; end;
 if (select count(*) from public.pos_finance_partners)<>1 then raise exception 'Rejected save damaged partners'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f","role":"authenticated"}',true);
do $$ begin
 begin
  perform public.configure_pos_profit_partners('[{"profileId":"1ef37cd2-6715-4ee0-a5d4-dd26124b5d5f","profitShare":100}]','[]');
  raise exception 'Manager configured partners';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
