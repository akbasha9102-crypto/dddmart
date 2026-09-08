-- Scope shifts SELECT to own-row-or-admin, and document why profiles SELECT
-- is left unchanged — fixes the READ-side slice of audit finding
-- (mashee_mart_security_audit.md, 🟠, "صفحات إدارية محمية بإخفاء واجهة
-- فقط، وصلاحيات القاعدة خلفها لا تفرّق الدور") covering `profiles` and
-- `shifts`. This is a SELECT-only change: no RPC, no security definer, no
-- write-side atomicity concerns — those were already handled for shifts'
-- write side by 00000000000029_atomic_shift_close.sql.
--
-- SCOPE NOTE (already discussed with the client, do not re-add): the
-- original audit finding also named operations_log and sales/sale_items.
-- Both are intentionally excluded here:
--   - operations_log's /archive page is adminOnly: false by design
--     (components/shared/navLinks.ts) — not a gap. Its RLS is untouched.
--   - sales/sale_items READ must stay store-wide for any cashier because
--     components/features/pos/ReturnLookup.tsx (a cashier-facing POS
--     feature) looks up ANY cashier's sale by invoice/barcode to process a
--     return. Restricting it would break that flow. The separate
--     cost_price column-leak concern there is deferred, not part of this
--     migration.
--
-- ============================================================================
-- shifts: cashiers could read every shift in the store (opening balances,
-- counted amounts, shortages/surpluses -- financial performance data about
-- OTHER employees), even though /shifts is adminOnly: true at the UI layer
-- (components/shared/navLinks.ts) -- classic UI-hiding-only pattern.
--
-- Grepped every .from("shifts") read in the app:
--   - getOpenShift/openShift (services/shifts.service.ts, called from
--     hooks/useShift.ts) are always called with cashierId = the caller's
--     own auth.uid() (useAuth().user.id) -- verified via grep, no call
--     site anywhere passes another user's id. Continues to work: the
--     row being fetched is always the caller's own, which the new policy
--     always allows.
--   - getShiftsForReport (services/shifts.service.ts:119, called only from
--     components/features/shifts/ShiftsList.tsx, rendered only on the
--     admin-gated /shifts page) needs every shift store-wide. Continues to
--     work for real admins: the policy's admin branch grants full store
--     visibility. A cashier who bypasses the UI and calls it directly now
--     gets back only their own shift rows instead of every employee's --
--     exactly the fix.
-- No other .from("shifts") read exists anywhere in the app (confirmed via
-- grep across services/, hooks/, components/, app/).
-- ============================================================================

drop policy if exists "authenticated read shifts" on shifts;

create policy "read own shift or admin read all" on shifts for select to authenticated
  using (
    store_id = current_store_id()
    and (
      cashier_id = auth.uid()
      or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    )
  );

-- ============================================================================
-- profiles: deliberately NOT changed in this migration. Investigated
-- whether the same "self row OR admin" shape could apply here too, and
-- concluded it cannot without a code-level regression:
--
-- Grepped every .from("profiles") read in the app:
--   - context/AuthContext.tsx, lib/employees/requireAdmin.ts: self-row
--     only (eq("id", auth.uid())) -- unaffected by any policy shape
--     considered here, listed for completeness.
--   - services/employees.service.ts (listEmployees/getEmployee): full row
--     (id, full_name, role, is_active, created_at) over ALL profiles in
--     the store, but only ever called from the admin-gated /employees and
--     /employees/[id] pages.
--   - services/archive.service.ts#listOperations: id, full_name only, over
--     ARBITRARY other users' ids in the store, called from /archive --
--     which components/shared/navLinks.ts marks adminOnly: false, i.e.
--     genuinely, intentionally cashier-visible. ArchiveList.tsx renders
--     operation.actorName for every logged action regardless of who
--     performed it (e.g. "فتحت الوردية من قبل أحمد" seen by a cashier
--     other than أحمد).
--   - services/sales.service.ts (getSalesForExport/getCashierRanking),
--     services/shifts.service.ts#getShiftsForReport: id, full_name only,
--     but only reached from the admin-gated /sales and /shifts pages.
--
-- A blanket "self row OR admin" restriction (the shape used for shifts
-- above) would 403 listOperations's cross-user full_name lookup for any
-- cashier viewing /archive, degrading every log line describing another
-- employee's action to "غير معروف" -- a real functional regression on a
-- page already confirmed to be intentionally cashier-visible. Postgres RLS
-- is row-level, not column-level, and every profiles read from the browser
-- goes through the same `authenticated` Postgres role regardless of the
-- caller's actual role column -- so there is no clean native way to say
-- "any cashier may read id/full_name of every row, but only admins may
-- read role/is_active" via RLS or GRANT alone. The correct fix for that
-- finer split is a SECURITY DEFINER view or RPC exposing only id/full_name
-- for cross-user name resolution, plus migrating listOperations (and the
-- analogous sales/shifts report lookups) to call it instead of querying
-- profiles directly -- genuine code-level work, out of scope for this
-- SELECT-policy-only, no-RPC pass.
--
-- Decision: leave "authenticated read profiles" (store-scoped, all
-- columns, to any authenticated same-store user) as-is. Residual risk:
-- any cashier can enumerate every coworker's full_name, role, and
-- is_active flag in their store via direct REST -- a roster/role
-- enumeration leak, not a financial or contact-PII leak (profiles has no
-- salary/phone/email columns). Rated lower severity than the shifts gap
-- fixed above, and than the already-fixed role-self-escalation bug
-- (migration 26). Revisit if/when the SECURITY DEFINER name-resolution
-- view is built for archive/sales/shifts reporting.
-- ============================================================================
