# Focused audit fixes

## Applied database changes

`supabase/audit-hardening.sql` was explicitly approved and applied on 14 October 2026.

- Direct order UPDATE requires an active Admin. Existing delivery/return RPCs remain available.
- Finance settings SELECT retains Management access; writes require Admin.
- Missing finance partner, payment and manual-sale tables created with RLS enabled.
- Manual-sale/payment INSERT requires Admin and created_by matching auth.uid().
- Payments and manual sales reject locked dates; existing expense trigger is unchanged.
- Diagnostic records have Admin-only SELECT. Clients submit through a permission-checked RPC.
- Diagnostics limited to 30 events per user per minute and 200 stored events per user.

Rollback-only tests impersonated available active roles and checked order/settings writes,
manual sale and payment inserts, diagnostic ingestion and read access. All passed.
No test business records were retained. Identity sequences may advance during rollback tests.

## App changes

- Equipment saves await confirmed database writes, detect zero affected rows, show failures,
  retain drafts on failure and prevent duplicate saves.
- Expense editing, Finance forms, stock counts and equipment edits participate in draft guards.
- Pull refresh and main-tab navigation ask before discarding an open draft.
- Browser reload/close uses the browser's native beforeunload prompt where supported.
- React crashes have a recovery screen. Runtime errors, unhandled promises, failed requests,
  slow requests over 2 seconds, tab transitions over 200ms and page load timing are recorded.
- Only allowlisted categories, screens and durations are recorded. No raw errors, URLs, tokens,
  descriptions, or form values are captured. Diagnostic history is bounded to 200 locally.
- Admin Settings provides a JSON diagnostic export including local and remote records.
- Remote reporting is best-effort and throttled. It can be disabled with VITE_DIAGNOSTICS_REMOTE=false.
- Mobile Overview supporting text uses 12px; inputs remain 16px. Theme and stock row touch targets are 44px.

## Still requires an actual iPhone

On Safari and optionally an installed home-screen app, check at default and larger text sizes:
1. Open every tab in both themes; look for clipped labels and sideways movement.
2. Open expense, missing-sale (Admin), stock count and equipment edit forms.
3. Focus first and last fields. Confirm keyboard does not hide the focused field or Save button.
4. Make a draft, pull to refresh, cancel the prompt and verify the entry remains.
5. Change tabs with a draft, cancel, and verify it remains. Accept and verify navigation works.
6. On a test record, try saving offline; confirm the error and retained draft, then retry online.
7. Check selected tabs, disabled controls, status colours, and 44px touch targets.

No actual iPhone or deployed Edge Function inspection was performed in this run.
The existing stock auto-sync and separate sale/stock writes remain outside this focused change.

## Security advisor follow-up

No new unprotected-table warning was reported. The advisor flags authenticated
SECURITY DEFINER RPCs: these are intentional, permission checked and use a fixed
empty search_path. The legacy pos_users table remains RLS-enabled without policies
(default denial). Leaked-password protection is disabled in project Auth settings;
that pre-existing account setting was not changed in this focused pass.

## Regression suite added and run

- `npm test`: 39 passing tests, including delayed/failed equipment saves,
  draft cancellation/reload guards, request-error classification, monitoring privacy,
  diagnostic recursion prevention and bounded diagnostic storage.
- `npm run lint`: passed.
- `npm run build`: passed (existing bundle-size warning remains).
- `supabase/tests/audit-permissions.sql`: run successfully against the connected project.
  Active-role permission assertions and anonymous diagnostic denial passed. All test
  writes rolled back; identity sequence gaps from tests are harmless.

## Responsive browser check (not an actual iPhone)

At 320px width, light and dark POS, Orders, Stock and Management had matching
main client/scroll widths and no horizontal document overflow. Current non-admin
Finance correctly omitted Missing sale and both payout buttons. Actual keyboard,
Admin Settings, Admin-only forms and physical iPhone contrast checks remain pending.

The browser measurement still found 38px Overview/Finance tabs and 31.5px date
presets, below the intended 44px touch height. This is recorded as an unresolved
mobile polish finding rather than a passing result.

An unsaved-expense navigation check stalled browser control during the expected
confirmation flow. Prompt cancellation and draft persistence are covered by unit
tests but that interactive check is blocked, not passed. A test amount of 123 was
entered; no expense was submitted. Browser controls also stalled while resetting
the temporary viewport; cancel the visible discard dialog before continuing UI tests.

Follow-up: the user dismissed the prompt. Browser control recovered and the viewport
was reset successfully. The visible screen was Orders rather than the expense form,
so the original draft-persistence check remains inconclusive; no expense was saved
by the test.

## Sequential improvement 1: mobile controls

Tabs and date presets now have a 44px minimum height and 12px labels at mobile widths.
The header account button is 44px to match the theme toggle. At a 320px browser
viewport, Orders tabs measured 49.2px high, header buttons 44x44px, and the document
width remained 320px. The browser viewport was successfully reset afterward.
Actual iPhone keyboard and accessibility text-size checks remain pending.
