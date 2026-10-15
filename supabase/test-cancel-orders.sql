-- Run after cancel-orders.sql. Every fixture is rolled back.
begin;
DO $$
DECLARE actor uuid; payload jsonb; snap jsonb; restored jsonb; flavour jsonb; eid bigint:=890000000000003;
BEGIN
 SELECT id INTO actor FROM public.pos_profiles WHERE role<>'Admin' AND NOT coalesce(paused,false) LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No active staff fixture'; END IF;
 SELECT sub_items->0 INTO flavour FROM public.pos_stock WHERE name='Flavour' LIMIT 1;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO snap FROM public.pos_stock s;
 payload:=jsonb_build_object('id',eid,'flavour',flavour,'type','full','payment','cash','price',100,'time',now(),'session_date',(now() AT TIME ZONE 'Africa/Johannesburg')::date,'sold_by','Rollback test');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 IF NOT public.record_pos_sale(payload) THEN RAISE EXCEPTION 'Sale rejected'; END IF;
 IF NOT public.cancel_pos_order(eid) THEN RAISE EXCEPTION 'Cancellation failed'; END IF;
 IF public.cancel_pos_order(eid) THEN RAISE EXCEPTION 'Repeat cancellation accepted'; END IF;
 IF public.record_pos_sale(payload) THEN RAISE EXCEPTION 'Cancelled sale replay accepted'; END IF;
 RESET ROLE;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO restored FROM public.pos_stock s;
 IF snap IS DISTINCT FROM restored THEN RAISE EXCEPTION 'Stock not restored exactly'; END IF;
 payload:=jsonb_set(payload,'{id}',to_jsonb(eid+1));
 SET LOCAL ROLE authenticated;
 PERFORM public.record_pos_sale(payload);
 IF NOT public.mark_pos_order_delivered(eid+1) THEN RAISE EXCEPTION 'Delivery fixture failed'; END IF;
 IF public.cancel_pos_order(eid+1) THEN RAISE EXCEPTION 'Delivered order cancelled'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.cancel_pos_order(eid+1);
  RAISE EXCEPTION 'Signed-out cancellation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
rollback;
