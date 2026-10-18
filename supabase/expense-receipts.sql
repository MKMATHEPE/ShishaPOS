begin;
alter table public.pos_expenses add column if not exists receipt_path text;
alter table public.pos_expenses add constraint expense_receipt_owner_path check (
 receipt_path is null or (submitted_by is not null and receipt_path ~ ('^' || submitted_by::text || '/[0-9a-f-]{36}\.jpg$'))
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('expense-receipts','expense-receipts',false,10485760,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy expense_receipt_upload on storage.objects for insert to authenticated
with check(bucket_id='expense-receipts' and private.has_pos_permission('management')
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.jpg$'));
create policy expense_receipt_read on storage.objects for select to authenticated
using(bucket_id='expense-receipts' and private.has_pos_permission('management') and (
 (storage.foldername(name))[1]=(select auth.uid())::text
 or (exists(select 1 from public.pos_profiles p where p.id=(select auth.uid()) and p.role in ('Admin','Manager') and p.paused=false) and exists(select 1 from public.pos_expenses e where e.receipt_path=name))
));
commit;
