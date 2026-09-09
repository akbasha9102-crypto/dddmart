# Fractional / Weighed-Goods Quantities — Design

## Problem

Every quantity in dddmart (`products.quantity` and every stock-movement
table derived from it) is a whole-number `integer`. The client is a real
supermarket that sells items by weight (chicken, produce, bulk sugar), not
just by count. Today the quantity input on `ProductForm` silently rejects a
fractional value like `12.5` — the browser's native HTML5 validation blocks
the "حفظ" button with no error message shown, because the input has no
`step` attribute (defaults to whole numbers only). This was UX finding #2 of
the 2026-09-09 multi-agent E2E test report
(`multi_agent_e2e_test_report.md`). The real fix is not a better error
message — it's genuine fractional-quantity support end to end, since the
client confirmed the store does sell weighed goods.

## Goals (confirmed with user during brainstorming)

- Weight entry is **manual only** in this version — the cashier types the
  weight after selecting a product. No barcode-embedded-weight scanning
  (a store scale printing a barcode with the weight/price encoded in it) —
  flagged as a possible future item, explicitly out of scope here.
- Products are tagged **individually** as `sold_by_weight` — count-based
  products (cans, boxes) keep strict whole-number quantities everywhere; a
  cashier cannot accidentally enter `2.5` for a canned good.
- Precision: `numeric(10, 3)` — up to 3 decimal places (gram-level, e.g.
  `1.250` كغم).
- A weighed product sells only in its own base unit (e.g. كغم) in this
  version — it does not participate in the existing `product_units`
  multi-unit system (كرتون/علبة ratios), which is unrelated (whole-number
  packaging ratios, not weight). Revisit later if a weighed product ever
  needs a secondary packaged unit.
- When a weighed product is scanned by barcode, it's added to the cart with
  a default quantity of `1` (as if 1 كغم) — the cashier corrects it in the
  cart via the new decimal input immediately after. Simpler than intercepting
  the scan flow with a dedicated weight-entry prompt; accepted trade-off.
- Every flow that can record a stock movement for a product — sale, return,
  damage, stock purchase (receiving), reconciliation — must support
  fractional quantities for a weighed product, not just checkout. A
  half-kilo of spoiled chicken must be damage-recordable as `0.500`, not
  force-rounded to `1`.

## Database layer — IMPLEMENTED AND APPLIED LIVE

Migration `supabase/migrations/00000000000044_fractional_quantity_support.sql`,
applied to the live production Supabase project (`klctindutdkvsmnsegwy`) on
2026-09-09 and verified (dry-run via `begin;...rollback;`, then a real
`begin;...commit;` apply, then a live read-only verification query — see
this session's transcript). This section documents what shipped, for
reference by the frontend/math work below and by anyone reading this spec
after the fact.

**Column type changes** (`integer` → `numeric(10, 3)`, a safe non-lossy
Postgres cast, no `USING` clause needed):
- `products.quantity`, `products.min_stock_threshold`
- `sale_items.quantity`
- `returns.quantity`
- `stock_damages.quantity`
- `stock_purchases.quantity`
- `stock_reconciliations.previous_quantity`, `counted_quantity`, `difference`

**New column:** `products.sold_by_weight boolean not null default false` —
existing products are unaffected (default preserves today's integer-only UX
for them).

**Deliberately unchanged:** `product_units.conversion_factor` and
`sale_items`/`returns.unit_conversion_factor` stay `integer` — the
multi-unit packaging ratio system is orthogonal to weight (see Goals).

**View dependency handled:** `sale_items_secure` (migration 34, masks
`cost_price` from non-admins) had a rule depending on `sale_items.quantity`,
which blocks `ALTER COLUMN ... TYPE` directly (no `CASCADE` option exists
for that ALTER form). The view is dropped immediately before the `ALTER
TABLE sale_items` statement and recreated byte-for-byte identical
immediately after, with its `grant select ... to authenticated` reissued
(dropping a view also drops privileges granted directly on it). Confirmed
via grep this is the only view depending on any of the changed columns.

**Five RPC functions changed signature** (required an explicit `drop
function` by exact old signature + fresh `create function`, since
`create or replace function` cannot change a parameter's type — Postgres
resolves function identity by name + argument type list, so replacing
`integer` with `numeric` would create a second overloaded function instead
of replacing the first, leaving PostgREST's RPC name resolution ambiguous).
Function bodies are unchanged except the parameter type itself (and, for
`record_reconciliation`, its one local variable holding the computed
difference):
- `adjust_product_stock(p_product_id uuid, p_delta numeric)` — was
  migration 23's version, not migration 3's original.
- `receive_product_stock(p_product_id uuid, p_added_base_units numeric,
  p_unit_base_cost numeric)` — was migration 32's version.
- `record_return(..., p_quantity numeric, ..., p_unit_conversion_factor
  integer, ...)` — only `p_quantity` changed; the unit-conversion-factor
  parameter is untouched (see "deliberately unchanged" above).
- `record_damage(p_product_id uuid, p_product_name text, p_quantity
  numeric, p_reason text)`.
- `record_reconciliation(p_product_id uuid, p_product_name text,
  p_counted_quantity numeric, p_reason text)` — local `v_difference` is now
  `numeric` so a fractional shortage/overage is recorded exactly.

**Two functions needed NO change**: `create_sale_atomic` (migration 42) and
`hold_sale` (migration 43) already parse their per-line quantity out of a
`jsonb` payload via `(v_line->>'quantity')::numeric` — `jsonb` has no static
column typing, so both were already fractional-quantity-safe the moment
`products.quantity` itself became `numeric`.

Confirmed via a full repo grep before writing the migration: none of the
five changed functions call each other or are called from any other SQL
function — each is invoked only from its own TypeScript service, so
dropping and recreating each in isolation carries no cross-function
dependency risk.

## Frontend layer — DESIGNED, NOT YET IMPLEMENTED

### Types

- `types/product.ts` — add `sold_by_weight: boolean` to the `Product`
  interface (mirrors the new DB column).
- `types/pos.ts` — add `soldByWeight: boolean` to `CartItem`, populated by
  `productToCartItem`/`productUnitToCartItem` from `product.sold_by_weight`.

### `ProductForm.tsx`

- New checkbox "يباع بالوزن" bound to `sold_by_weight`. When checked, the
  "الكمية" and "حد التنبيه" `Input`s switch from their current implicit
  whole-number behavior to `step="0.001"`. When unchecked (the default,
  matching every existing product), both fields keep today's whole-number-only
  behavior exactly as now — this is what prevents a cashier/admin from
  entering `2.5` for a canned good.
- Fixes E2E finding #2 as a side effect: replace the silent
  browser-native-`required` block on the barcode field with an explicit
  check in `handleSubmit` (`if (!barcode.trim()) { setError("الباركود
  مطلوب"); return; }`), matching the existing explicit-validation pattern
  already used there for cost price / sale price. The quantity field's
  fractional-rejection issue is resolved structurally by the `step`
  attribute changing per `sold_by_weight` above — no separate error-message
  patch needed for that specific case once the real feature exists.

### Cart & manual entry (`ManualProductPicker.tsx`, `CartGrid.tsx`)

- Count-based products (`sold_by_weight === false`, the default): the
  existing `+`/`-` stepper UI is completely unchanged.
- Weighed products (`sold_by_weight === true`): the stepper is replaced with
  a numeric text `Input` (`step="0.001"`) the cashier types the weight into
  directly, capped against `product.quantity` on confirm (not on every
  keystroke, so typing "1.2" doesn't trip a premature cap mid-entry) with an
  inline error if the entered weight exceeds available stock.
- Barcode scan of a weighed product adds to the cart at a default quantity
  of `1` (as if 1 كغم) — no special-cased scan-time prompt (see Goals). The
  cashier corrects the actual weighed amount via the cart's new decimal
  input immediately after scanning.
- New `formatQuantity(quantity: number, soldByWeight: boolean, unit: string):
  string` helper (`lib/utils.ts`, alongside `formatCurrency`) — trims
  trailing zeros for a clean display (`1.250` → `"1.25 كغم"`) instead of a
  fixed 3-decimal string; count items display as a plain integer, unchanged.
  Applied at minimum to `ManualProductPicker`'s "متوفر N" label and
  `StockTable.tsx`/`CategoryProductList.tsx`'s quantity column. Receipts and
  exports are not required to change for this to function correctly (a raw
  fractional number displays acceptably even unformatted); applying
  `formatQuantity` there too is optional polish, not a functional
  requirement of this spec.

## Math / rounding layer — DESIGNED, NOT YET IMPLEMENTED

### The gap found

`create_sale_atomic` rounds **each line** to 2 decimals
(`round(v_unit_price * v_quantity, 2)`) **before** summing into
`v_subtotal`. The client's `calculateTotals` (`types/pos.ts`) and the
offline-receipt line-total computation (`hooks/usePOS.ts`, the
`total_price: item.unitPrice * item.quantity` payload field) do not round
per line before summing. With whole-number quantities this never mattered —
a 2-decimal price times an integer can't introduce more precision than the
price already had, so no rounding was ever actually needed. With a
3-decimal fractional quantity, `unitPrice * quantity` can produce up to 5
decimal places, and summing un-rounded values before a single final rounding
can diverge from the server's per-line-rounded sum by a fraction of a cent
in rare boundary cases — surfacing as a spurious "price mismatch" banner
(the existing `markPriceMismatch` offline-sync check) or a wrong total
printed on an offline receipt.

### The fix

- New `roundMoney(value: number): number` helper (`lib/utils.ts`) —
  `Math.round((value + Number.EPSILON) * 100) / 100` (the `Number.EPSILON`
  nudge avoids the classic JS binary-float glitch where `Math.round(1.005 *
  100)` evaluates to `100` instead of `101`). Matches Postgres `round(numeric,
  2)`'s round-half-away-from-zero behavior for the always-non-negative money
  values this app computes.
- Applied **per line, before summing** — exactly mirroring
  `create_sale_atomic`'s algorithm — in two places:
  - `calculateTotals` (`types/pos.ts`): each `item.unitPrice * item.quantity`
    is rounded via `roundMoney` before being added into `subtotal`.
  - `hooks/usePOS.ts`'s offline receipt line-total (`total_price:` field):
    same `roundMoney(item.unitPrice * item.quantity)`.
- New companion `roundQuantity(value: number): number` helper — rounds a
  typed weight entry to 3 decimals (`Math.round(value * 1000) / 1000`)
  immediately on input/blur in the weight-entry `Input`s (`ManualProductPicker`,
  `CartGrid`), preventing any small float-drift artifact (e.g.
  `1.2000000000000002`) from ever reaching the cart state or a checkout
  payload, matching the DB's `numeric(10,3)` precision exactly.
- `CartGrid.tsx`'s live per-line display multiplication is optionally
  wrapped in `roundMoney` too for full consistency, though `formatCurrency`'s
  underlying `Intl.NumberFormat` already visually rounds to 2 decimals
  regardless — low-priority polish, not required for correctness.

No SQL changes are needed for this layer — `create_sale_atomic`'s rounding
was already correct; this layer only brings the client's arithmetic in line
with it.

## Testing

- Frontend: `ProductForm` tests for the new `sold_by_weight` checkbox
  gating the quantity/threshold `step` attribute, and for the barcode
  explicit-error-message fix. `ManualProductPicker`/`CartGrid` tests for the
  weight-input-vs-stepper branch and the confirm-time stock cap.
- Math: unit tests for `roundMoney`/`roundQuantity` covering the classic JS
  float-rounding boundary cases, and a `calculateTotals` test asserting
  per-line rounding matches what `create_sale_atomic` would compute for the
  same fractional-quantity cart (e.g. a 3-line cart mixing weighed and
  count items).
- No new SQL-level tests are needed — the five changed RPCs' existing
  logic/security tests are unaffected by the parameter type change alone;
  spot-check via `typecheck`/`lint`/full `test`/`build` after the frontend
  changes land, same as every other change this session.

## Out of scope (explicitly, for a possible later iteration)

- Barcode-embedded weight (a store scale printing weight/price into the
  barcode itself) — Goals section, deferred by the client's own choice.
- A weighed product participating in the `product_units` secondary-unit
  system (e.g. a pre-bagged 5kg box of a normally-loose product).
- Formatting polish for receipts/exports/detailed reports beyond the two
  screens (`ManualProductPicker`, `StockTable`/`CategoryProductList`) named
  above.
