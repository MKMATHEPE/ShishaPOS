begin;
CREATE OR REPLACE FUNCTION private.guard_expense_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.approval_status := 'pending'; NEW.submitted_by := auth.uid();
  NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.payment_by := NULL; NEW.payment_at := NULL;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.approval_status='paid' THEN RAISE EXCEPTION 'Settled expenses cannot be deleted.'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.approval_status='paid' THEN
  IF NEW.approval_status<>'approved' OR NOT private.is_pos_admin() THEN RAISE EXCEPTION 'Only Admins can undo an expense payment.'; END IF;
  IF (to_jsonb(NEW)-'approval_status') IS DISTINCT FROM (to_jsonb(OLD)-'approval_status') THEN RAISE EXCEPTION 'Undo payment separately from expense edits.'; END IF;
  NEW.payment_at := NULL; NEW.payment_by := NULL;
  RETURN NEW;
 END IF;
 IF NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.payment_by IS DISTINCT FROM OLD.payment_by OR NEW.payment_at IS DISTINCT FROM OLD.payment_at THEN
  RAISE EXCEPTION 'Audit fields cannot be edited.';
 END IF;
 IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
  IF NOT private.is_pos_admin() THEN RAISE EXCEPTION 'Only Admins can approve or mark expenses paid.'; END IF;
  IF (to_jsonb(NEW)-ARRAY['approval_status']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['approval_status']) THEN RAISE EXCEPTION 'Save expense changes before approval.'; END IF;
  IF OLD.approval_status='pending' AND NEW.approval_status='approved' THEN
   NEW.approved_at := now(); NEW.approved_by := auth.uid();
  ELSIF OLD.approval_status='approved' AND NEW.approval_status='paid' THEN
   NEW.payment_at := now(); NEW.payment_by := auth.uid();
   IF NEW.paid_by IS NOT NULL THEN
    INSERT INTO public.pos_finance_transactions(kind,profile_id,amount,description,transaction_date,created_by)
    VALUES('reimbursement',NEW.paid_by,NEW.amount,'Expense #'||NEW.id,(now() AT TIME ZONE 'Africa/Johannesburg')::date,auth.uid());
   END IF;
  ELSE RAISE EXCEPTION 'Approve the expense before marking it paid.';
  END IF;
 ELSE
  NEW.approval_status := 'pending'; NEW.approved_at := NULL; NEW.approved_by := NULL;
 END IF;
 RETURN NEW;
END $function$;


create table if not exists private.expense_payment_corrections (
 id bigint generated always as identity primary key,
 expense_id bigint not null,
 corrected_at timestamptz not null default now(),
 corrected_by uuid not null,
 expense_snapshot jsonb not null,
 reimbursement_snapshot jsonb
);
alter table private.expense_payment_corrections enable row level security;
revoke all on private.expense_payment_corrections from public,anon,authenticated;
create or replace function private.reverse_expense_payment() returns trigger
language plpgsql security definer set search_path='' as $$
declare payment public.pos_finance_transactions%rowtype; payment_count integer; locked date;
begin
 if old.approval_status<>'paid' or new.approval_status<>'approved' then return new; end if;
 if not private.is_pos_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select locked_through into locked from public.pos_finance_settings where id=true;
 if locked is not null and ((old.time at time zone 'Africa/Johannesburg')::date<=locked or (old.payment_at at time zone 'Africa/Johannesburg')::date<=locked) then raise exception 'This accounting period is locked.'; end if;
 perform 1 from public.pos_finance_transactions where description='Expense #'||old.id for update;
 select count(*) into payment_count from public.pos_finance_transactions where description='Expense #'||old.id;
 if payment_count>1 then raise exception 'Multiple reimbursements match. Ask Admin to review the journal.'; end if;
 if payment_count=1 then
  select * into payment from public.pos_finance_transactions where description='Expense #'||old.id;
  if old.paid_by is null or payment.kind<>'reimbursement' or payment.profile_id is distinct from old.paid_by or payment.amount<>old.amount or payment.created_by is distinct from old.payment_by or old.payment_at is null then raise exception 'Reimbursement does not match this payment. Review the journal.'; end if;
  if locked is not null and payment.transaction_date<=locked then raise exception 'This accounting period is locked.'; end if;
 elsif old.paid_by is not null and old.payment_at is not null then
  raise exception 'Linked reimbursement is missing. Review the journal before undoing payment.';
 end if;
 insert into private.expense_payment_corrections(expense_id,corrected_by,expense_snapshot,reimbursement_snapshot)
 values(old.id,auth.uid(),to_jsonb(old),case when payment_count=1 then to_jsonb(payment) else null end);
 if payment_count=1 then delete from public.pos_finance_transactions where id=payment.id; end if;
 return new;
end $$;
revoke all on function private.reverse_expense_payment() from public,anon,authenticated;
drop trigger if exists expense_payment_reversal on public.pos_expenses;
create trigger expense_payment_reversal after update on public.pos_expenses for each row execute function private.reverse_expense_payment();

commit;
