# Stock Reconciliation (تسوية الجرد) — Design

## Problem

Physical stock counts (checking shelves/fridges) don't always match the
system quantity — daily movement, miscounts, or theft cause drift. Right
now there's no way to correct a product's `quantity` to match a physical
count except editing the product directly (no audit trail, no loss
visibility). The client wants a simple way to reconcile the system quantity
against a physical count, and to see the resulting loss (shrinkage/theft)
reflected in reporting — same motivation as the existing damage-tracking
feature, but for count discrepancies rather than confirmed damage.

## Existing pattern this reuses

This repo already has an almost identical feature: damaged/expired stock
tracking (`stock_damages` table, `services/damages.service.ts`,
`DamageStockForm.tsx`, netted into all 5 sales-reporting surfaces in
`services/sales.service.ts`). Stock reconciliation follows the exact same
shape — append-only audit table, RLS scoped by `store_id`, admin-only UI
entry point from `StockTable`, atomic stock adjustment, loss netted into
reporting — with two differences: it uses the existing
`adjust_product_stock(product_id, delta)` RPC (already supports positive
*and* negative deltas, unlike `decrementStock` which only decrements)
because a reconciliation can go either direction, and its loss is reported
under its own label ("فروقات الجرد") so the owner can tell confirmed
damage apart from unexplained shortages/theft.

## Data model

New migration `00000000000014_stock_reconciliation.sql`:

```sql
create table stock_reconciliations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  unit text not null,
  previous_quantity integer not null,
  counted_quantity integer not null check (counted_quantity >= 0),
  difference integer not null,              -- counted_quantity - previous_quantity
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  loss_value numeric(12, 2) not null default 0 check (loss_value >= 0),
  reason text,
  actor_id uuid references profiles (id) on delete set null,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);
```

- Append-only: select + insert policies only, both
  `store_id = current_store_id()` — no update/delete, matching
  `returns`/`stock_damages`.
- `previous_quantity`/`counted_quantity`/`unit`/`cost_price` are snapshots
  at reconciliation time (same rationale as `stock_damages.cost_price`).
- `loss_value` is populated only when `difference < 0`
  (`abs(difference) * cost_price`); zero when `difference >= 0`. A count
  that finds *more* stock than the system shows is recorded for audit and
  corrects the quantity, but is never treated as profit — avoids any
  incentive to game counts for a paper gain.
- Indexes on `created_at`, `product_id`, `store_id` (mirrors
  `stock_damages`).

## Stock adjustment logic

`services/reconciliations.service.ts#recordReconciliation(supabase, {productId, productName, countedQuantity, reason}, actorId, storeId)`:

1. Re-fetch the product fresh (`quantity`, `cost_price`, `unit`) at call
   time rather than trusting a value the UI opened with — stock can move
   (a sale) between opening the form and submitting.
2. `difference = countedQuantity - product.quantity`. If `0`, throw
   ("لا يوجد فرق لتسجيله") — the UI also disables submit in this case so
   this is a defensive backstop, not the primary guard.
3. Call `adjust_product_stock(productId, difference)` (existing RPC from
   migration 3). Since `countedQuantity >= 0` by construction, the RPC's
   `quantity + delta >= 0` guard can only fail if stock changed again in
   the narrow window between step 1 and this call — in that rare case,
   re-fetch and surface the same "insufficient stock" style error
   `decrementStock` callers already handle.
4. `lossValue = difference < 0 ? Math.abs(difference) * product.cost_price : 0`.
5. Insert the `stock_reconciliations` row (previous_quantity = the fresh
   quantity from step 1).
6. `logOperation(...)` to the existing archive/audit log, Arabic
   description e.g. `تمت تسوية "اسم المنتج": من 20 إلى 18 (نقص 2) — السبب: اشتباه سرقة`.
7. Return the inserted row.

## UI

`components/features/inventory/StockReconciliationForm.tsx` (same shape as
`DamageStockForm.tsx`):

- Shows current system quantity (read-only, from the `product` prop).
- Input: "الكمية الفعلية بعد الجرد" (counted quantity), integer, min 0.
- Reason `<select>`: "جرد دوري" (default) / "اشتباه سرقة" / "خطأ إدخال سابق" / "أخرى" (+ free-text when "أخرى").
- Live preview once a valid count is entered: the difference (e.g. "نقص 2"
  / "زيادة 3"), and — only when negative — the estimated loss value.
- Submit disabled when the count equals the current quantity (no-op) or is
  invalid.

Wiring: `StockTable.tsx` gets a new `onReconcileStock` row action next to
the existing `onDamageStock`, gated the same way
(`isAdminRole(role)`). Inventory page (`app/(dashboard)/inventory/page.tsx`)
adds the matching modal state, following the exact pattern already used for
`damagingStockFor`/`DamageStockForm`.

## Reporting integration

Mirrors how `stock_damages` is netted into `services/sales.service.ts`
today, as a parallel, separately-labeled loss source:

- New `getReconciliationLossInRange` alongside the existing
  `getDamagesInRange`, fetching `stock_reconciliations` rows with
  `loss_value > 0` in the date range.
- Netted into the same 5 surfaces damages already touch: daily summary,
  report details, trend, product ranking, category ranking — bucketed by
  the reconciliation's own `created_at` day (same "day it happened, not
  day of the original sale" rule already used for returns/damage).
- Displayed as its own line, "فروقات الجرد", distinct from "التلف" in
  every surface that already shows a damage total, so the owner can see
  damage and shrinkage/theft as separate numbers instead of one merged
  bucket.
- Positive differences (found extra stock) are excluded from every profit
  calculation entirely — they only ever affect `products.quantity` and the
  audit trail.

## Testing

- Unit tests for `reconciliations.service.ts` (mirrors
  `damages.service.test.ts`): correct delta calculation for both shortage
  and overage, zero-loss-value on overage, zero-difference rejection,
  insufficient-stock race handled, `logOperation` called with the right
  description.
- Unit tests for the new reporting functions (mirrors existing
  damage-netting tests in `sales.service.test.ts`): loss correctly summed
  and subtracted, bucketed by the reconciliation's own day, overage rows
  excluded.
- `npm run typecheck && npm run lint && npm run test && npm run build`
  must all pass before commit.
- Manual verification: reconcile a product down (shortage) and confirm the
  quantity, archive log entry, and daily report's "فروقات الجرد" line all
  update correctly; reconcile a product up (overage) and confirm quantity
  updates but no loss/profit line changes; confirm the action is invisible
  to non-admin roles.
