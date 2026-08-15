# Cash Drawer / Shift Management (إدارة الورديات / درج النقدية) — Design

## Problem

There's no concept of a cashier shift. `sales.cashier_id` exists and is
already surfaced in per-cashier reporting (`getCashierRanking`), but
nothing wraps a cashier's work session: no opening cash balance, no
closing count, no computed shortage/surplus. Reporting only shows daily
totals for the whole store. Item #3 from the 2026-08-13 gaps-analysis
doc — flagged "ضروري جداً" (critical) for any store with more than one
cashier or more than one shift a day, since it's the main mechanism that
catches (or deters) cash handling errors and theft at handover.

## Existing pattern this reuses

Same shape as the damage/reconciliation features already in this repo:
a new table, RLS scoped by `store_id`, a service module, `logOperation`
audit entries, and — where the feature affects money — integration into
existing reporting. What's new here (no direct precedent in this repo)
is a stateful lifecycle (open → active → closed) rather than a single
append-only event row, and cross-referencing *other* tables
(`sales`, `customer_transactions`, `returns`) by cashier + time window
rather than a single insert.

## Data model

New migration `00000000000018_cash_drawer_shifts.sql`:

```sql
create table shifts (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references profiles (id) on delete cascade,
  store_id uuid not null references stores (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_balance numeric(12, 2) not null check (opening_balance >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  expected_amount numeric(12, 2),
  counted_amount numeric(12, 2),
  difference numeric(12, 2),
  forced_closed_by uuid references profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

-- one open shift per cashier at a time
create unique index shifts_one_open_per_cashier
  on shifts (cashier_id) where status = 'open';

create index shifts_store_id_idx on shifts (store_id);
create index shifts_cashier_id_idx on shifts (cashier_id);
create index shifts_opened_at_idx on shifts (opened_at);

alter table shifts enable row level security;

create policy "authenticated read shifts" on shifts for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert own shift" on shifts for insert to authenticated
  with check (store_id = current_store_id() and cashier_id = auth.uid());

create policy "close own shift or admin force-close" on shifts for update to authenticated
  using (
    store_id = current_store_id()
    and (
      cashier_id = auth.uid()
      or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    )
  )
  with check (store_id = current_store_id());
```

- `expected_amount`/`counted_amount`/`difference` are all null while
  `status = 'open'` — populated together, only at close time.
- Forced close (admin closes a shift the cashier left open): `counted_amount`
  and `difference` stay null (nobody physically counted the drawer),
  `expected_amount` is still computed and stored, `forced_closed_by` is set.
  This is a distinct, visible state in the report — not treated the same
  as a normal close.
- Read policy is store-wide (matches every other reporting table in this
  app — RLS is store-scoped, not per-role; role gating happens in the UI,
  same convention `isAdminRole` already follows elsewhere). The admin-only
  report page is a route-level check, not an RLS restriction.
- No update/delete beyond the single close transition — once
  `status = 'closed'`, the row is final, matching the
  returns/damages/reconciliation append-only convention.

Second, small schema change: `customer_transactions` currently has no
actor column at all — `recordPayment` logs the actor to `operations_log`
but never stores it on the row. Since cash debt payments must count
toward a shift's expected cash (confirmed with the client), add:

```sql
alter table customer_transactions add column cashier_id uuid references profiles (id) on delete set null;
create index customer_transactions_cashier_id_idx on customer_transactions (cashier_id);
```

`services/customers.service.ts#recordPayment` starts writing the
already-received `actorId` param into this new column (currently only
passed to `logOperation`) — a one-line change, no new parameter needed.

## Expected-amount calculation

The core question a shift close answers: "how much cash *should* be in
the drawer right now?" Computed from three existing tables, all filtered
to `cashier_id = shift.cashier_id` and `created_at` inside
`[shift.opened_at, closeTime)`:

```
expected_amount =
    opening_balance
  + SUM(sales.total_amount)              where payment_method = 'cash'
  + SUM(customer_transactions.amount)    where type = 'payment'
  - SUM(returns.refund_amount)           where the ORIGINAL sale's
                                          payment_method = 'cash',
                                          attributed by returns.actor_id
                                          (who processed the return, not
                                          who made the original sale)
```

Two things worth calling out (derived from existing data, not asked of
the client — both are natural consequences of "make the reconciliation
accurate"):

- **Credit sales are excluded** — no cash entered the drawer.
- **Cash refunds reduce the expected amount.** `returns` has no
  payment-method flag of its own, but it references `sale_id`, so
  whether a refund was actual cash leaving the drawer is derived by
  joining to the original sale's `payment_method`. A return on a
  credit-sale item reduces the customer's debt, not the cash drawer, so
  it's excluded. Attribution is by `returns.actor_id` (whoever is
  physically handing back the cash during *their* shift), not by who
  made the original sale — same "processed by" vs "sold by" distinction
  already established in `getCashierRanking`.
- `stock_damages`/`stock_reconciliations` never touch cash and are not
  part of this calculation.

## Service layer

`services/shifts.service.ts`:

- `getOpenShift(supabase, cashierId, storeId): Promise<Shift | null>` —
  used both for the POS gate (does this cashier have one already?) and
  to resume silently after a refresh/relogin.
- `openShift(supabase, { openingBalance }, cashierId, storeId): Promise<Shift>` —
  checks `getOpenShift` first and returns the existing row if one's
  already open (idempotent against a double-submit/race), otherwise
  inserts. Relies on the partial unique index as the hard backstop.
- `closeShift(supabase, { shiftId, countedAmount }, actorId, storeId, isForced): Promise<Shift>`:
  1. Fetch the shift; must belong to this store and be `status = 'open'`.
  2. Compute `expected_amount` per the formula above (three batched
     range queries, following the existing `getDamagesInRange`-style
     helper shape).
  3. `difference = isForced ? null : countedAmount - expected_amount`.
  4. Update the row: `closed_at = now()`, `expected_amount`,
     `counted_amount` (null if forced), `difference`,
     `status = 'closed'`, `forced_closed_by` (set to `actorId` only when
     `isForced`).
  5. `logOperation(...)` — Arabic description, e.g. `تم إغلاق وردية الكاشير "فلان" — المتوقع 45000، المعدود 44500، الفرق -500` (or a forced-close variant with no counted/difference figures).
  6. Return the updated row.
- `getShiftsForReport(supabase, { startDate, endDate }, storeId): Promise<ShiftWithCashierName[]>` —
  batched `cashier_id → profiles.full_name` lookup, same
  `"غير معروف"` fallback convention used three times already in this
  repo (`getSalesForExport`, `getCashierRanking`, `listOperations`).

## POS integration

- New `hooks/useShift.ts` (mirrors the shape of `useSoundSettings.ts` —
  thin, wraps the service calls + local state) exposed through
  `POSContext` alongside the existing `cashierId`/`storeId`.
- On mount, `POSPage` (or a small wrapping component,
  `components/features/pos/ShiftGate.tsx`) calls `getOpenShift`. No open
  shift → renders a blocking `Modal` (reusing the existing `Modal`/
  `Input`/`Button` components, same pattern as the existing hold-sale and
  reason-picker modals) asking for the opening balance; the rest of the
  POS UI does not render until it's submitted. An open shift already
  exists → renders normally, no modal, no interruption.
- New "إغلاق الوردية" button in the POS header (next to the existing
  🔊/🔇 sound toggle). Opens `CloseShiftModal.tsx`: shows the computed
  expected amount, an input for the counted amount, and on submit calls
  `closeShift` then re-triggers the `ShiftGate` (immediately prompts to
  open the next shift, same as the very first login).
- No changes to `checkout()`, `createSale`, or `recordPayment`'s call
  signature beyond the one new `cashier_id` field on the
  `customer_transactions` insert — the shift/sale link is by
  cashier + time window, not a threaded `shiftId` parameter (see the
  approach comparison from the earlier design discussion — this keeps
  the blast radius to reporting/service code, not the checkout hot path).

## Admin report

New page `app/(dashboard)/shifts/page.tsx`, admin-only (same
`isAdminRole` gate as `/suppliers`, `/employees`), added to
`Sidebar`/`BottomNav` admin nav.

- `ShiftsList.tsx`: table/card list (mobile card style, matching
  `StockTable`'s existing card-list convention rather than a `<table>`),
  filterable by date range (`RangeDatePicker`, reusing the existing
  `MAX_RANGE_DAYS` cap) and cashier. Columns: cashier name, opened/closed
  time, opening balance, expected, counted, difference.
- Any row with a non-zero difference is visually flagged (color/badge).
  Forced-closed rows are visually distinct (no counted/difference figures
  — shown as "لم يُعد" instead of a number) so they're never confused
  with a normal, verified close.
- Admin action on any `status = 'open'` row: "إغلاق قسري" → calls
  `closeShift(..., isForced = true)` directly from this list, no separate
  page.

## Error handling

- Opening balance must be `>= 0` (matches the DB check constraint);
  submit is disabled client-side for negative/empty input, same pattern
  as `StockReconciliationForm`'s guard on invalid input.
- `openShift` racing a double-submit (e.g. flaky network causing a
  retry) is idempotent via the check-then-insert plus the partial unique
  index as the DB-level backstop — no user-facing error in the normal
  case, an insert conflict (if it ever reaches the DB) is treated as
  "already open" and the existing row is re-fetched and returned.
- `closeShift` on an already-closed or nonexistent shift throws an
  Arabic error surfaced via the existing `Toast` component (e.g. "هذه
  الوردية مغلقة أصلاً") — defensive backstop, since the UI only ever
  offers closing on a shift it already knows is open.
- Counted amount must be `>= 0`; no upper bound (a large legitimate
  surplus is still valid data, not an input error).

## Testing

- Unit tests for `shifts.service.ts`: open-when-none-exists,
  open-when-one-already-exists returns the existing row (no duplicate
  insert), expected-amount calculation across all input combinations
  (cash sales only / with debt payments / with cash refunds / with a
  credit-sale return correctly excluded / mix of all four), normal close
  computes `difference` correctly (both shortage and surplus), forced
  close leaves `counted_amount`/`difference` null and sets
  `forced_closed_by`, closing an already-closed shift throws.
- Unit tests for `getShiftsForReport`: batched name lookup and
  `"غير معروف"` fallback (mirrors the existing three tests of this
  pattern).
- Unit test for `recordPayment`: `cashier_id` is written to the new
  column.
- `npm run typecheck && npm run lint && npm run test && npm run build`
  must all pass before commit.
- Manual verification (per the standing note that this app runs
  against the live client's real data — no throwaway test store): log in
  as a cashier with no open shift, confirm the blocking modal appears
  and POS is unusable until submitted; make a cash sale, a credit sale,
  and (if a customer with debt exists) a debt payment; close the shift
  and confirm the expected amount matches the sum by hand; confirm a
  forced close from the admin report works and is visually distinct from
  a normal close; confirm a cashier cannot see the "الورديات" nav
  item/page.
