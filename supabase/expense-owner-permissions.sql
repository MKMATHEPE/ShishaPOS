begin;
-- Existing Management permission remains required; these policies narrow writes.
create policy expenses_owner_update on public.pos_expenses as restrictive for update to authenticated
using ((select private.is_pos_admin()) or coalesce(submitted_by,paid_by)=(select auth.uid()))
with check ((select private.is_pos_admin()) or coalesce(submitted_by,paid_by)=(select auth.uid()));
create policy expenses_owner_delete on public.pos_expenses as restrictive for delete to authenticated
using ((select private.is_pos_admin()) or coalesce(submitted_by,paid_by)=(select auth.uid()));
commit;
