begin;
alter policy expense_receipt_read on storage.objects to authenticated
using(bucket_id='expense-receipts' and private.has_pos_permission('management') and (
 (storage.foldername(name))[1]=(select auth.uid())::text
 or (exists(select 1 from public.pos_profiles p where p.id=(select auth.uid()) and p.role in ('Admin','Manager') and p.paused=false)
 and exists(select 1 from public.pos_expenses e where e.receipt_path=name))
));
commit;
