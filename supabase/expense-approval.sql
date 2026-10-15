BEGIN;
-- Existing expenses were confirmed settled by the owner. No historical audit dates are invented.
ALTER TABLE public.pos_expenses ADD COLUMN approval_status text NOT NULL DEFAULT 'paid' CHECK (approval_status IN ('pending','approved','paid'));
ALTER TABLE public.pos_expenses ALTER COLUMN approval_status SET DEFAULT 'pending';
ALTER TABLE public.pos_expenses ADD COLUMN submitted_by uuid, ADD COLUMN approved_by uuid, ADD COLUMN approved_at timestamptz, ADD COLUMN payment_by uuid, ADD COLUMN payment_at timestamptz;
CREATE FUNCTION private.guard_expense_approval() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
 IF OLD.approval_status='paid' THEN RAISE EXCEPTION 'Settled expenses cannot be edited.'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION private.guard_expense_approval() FROM PUBLIC;
CREATE TRIGGER expense_approval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pos_expenses FOR EACH ROW EXECUTE FUNCTION private.guard_expense_approval();
COMMIT;
