# Expense approval — 15 October 2026

Activated `supabase/expense-approval.sql` in Shisha POS.

- Existing expenses are Paid following the owner's confirmation that they are settled. Historical audit fields stay empty.
- New expenses start Pending approval; only active Admins can approve then mark paid.
- Personally paid expenses create a reimbursement transaction when marked paid. This records a payment already made; it does not transfer money.
- Changes to an approved expense reset approval. Settled expenses cannot be edited or deleted.
- Admins see all loaded expenses regardless of the overview date selection, with status filters. Existing accounting-period locks remain enforced.
- Approval/payment do not add purchased stock again.

Rollback-only database test passed: new pending status, rejection of skipping approval, rejection of non-Admin approval, approval reset after editing, exactly one repayment, rejection of repeated payment, and unchanged stock. All test records rolled back.

60 automated tests, lint, and production build passed. Security advisor found no new warning from this change; existing guarded RPC warnings and disabled leaked-password protection remain outside this change.
