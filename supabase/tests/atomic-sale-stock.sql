begin;
do $$
declare actor uuid; payload jsonb; coal numeric; pieces numeric; flavour numeric; inventory jsonb; affected integer;
begin
 select id into actor from public.pos_profiles where role='Admin' and paused=false limit 1;
 if actor is null then raise exception 'Active Admin test role missing'; end if;
 update public.pos_stock set quantity=50 where name in ('Coal','Mouth Pieces');
 update public.pos_stock s set sub_items=(select jsonb_agg(jsonb_set(value,'{quantity}','10'::jsonb) order by ord) from jsonb_array_elements(s.sub_items) with ordinality a(value,ord)) where name='Flavour';
 select jsonb_agg(jsonb_build_object('id',id,'qty',quantity) order by id) into inventory from public.pos_stock where category='equipment';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 execute 'set local role authenticated';
 payload:=jsonb_build_object('id',-900014140001,'flavour','Lady Killer','type','full','payment','cash','price',170,'time','2026-10-14T12:00:00Z','session_date','2026-10-14','sold_by','rollback-test');
 perform public.record_pos_sale(payload);
 select quantity into coal from public.pos_stock where name='Coal';
 select quantity into pieces from public.pos_stock where name='Mouth Pieces';
 select (value->>'quantity')::numeric into flavour from public.pos_stock,jsonb_array_elements(sub_items) where name='Flavour' and value->>'id'='lk';
 if coal<>48 or pieces<>48 or flavour<>9.714 then raise exception 'Initial stock deduction incorrect'; end if;
 perform public.record_pos_sale(payload);
 if (select quantity from public.pos_stock where name='Coal')<>48 then raise exception 'Retry deducted twice'; end if;
 begin
  perform public.record_pos_sale(payload||'{"price":120}'::jsonb);
  raise exception 'Different sale accepted existing ID';
 exception when unique_violation then null; end;
 begin
  perform public.record_pos_sale(payload||'{"id":-900014140002,"flavour":"INVALID"}'::jsonb);
  raise exception 'Invalid flavour accepted';
 exception when raise_exception then if sqlerrm<>'Unknown flavour' then raise; end if; end;
 if exists(select 1 from public.pos_orders where id=-900014140002) or (select quantity from public.pos_stock where name='Coal')<>48 then raise exception 'Failed sale partially committed'; end if;
 perform public.record_pos_sale(payload||'{"id":-900014140003,"flavour":"Gum & Mint","type":"refill"}'::jsonb);
 if (select quantity from public.pos_stock where name='Coal')<>46 then raise exception 'Second distinct sale lost deduction'; end if;
 if inventory is distinct from (select jsonb_agg(jsonb_build_object('id',id,'qty',quantity) order by id) from public.pos_stock where category='equipment') then raise exception 'Sale changed equipment before delivery'; end if;
 update public.pos_stock set quantity=500 where name='Coal';
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Stale consumable write allowed'; end if;
 execute 'reset role';
end $$;
rollback;
select 'PASS: atomic sale, exact retry, collision rejection, failed-sale rollback, distinct sales, equipment unchanged, stale consumable writes denied; no test data retained' as result;
