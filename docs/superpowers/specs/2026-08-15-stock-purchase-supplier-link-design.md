# Link Stock Receiving to Purchase Invoices — Design

## Problem

`receive_product_stock` (and the `recordStockPurchase` service function that
wraps it) only increments `products.quantity` and recomputes the weighted
average `cost_price`. It records no supplier, no purchase invoice number,
and no payment status (paid the supplier cash on the spot, or bought on
credit/آجل). Without this, the merchant can't match paper supplier invoices
against the system, or know what he currently owes each supplier from stock
he's already received. This was gap #5 in `docs/gaps-analysis.md`, a direct
follow-on to the just-shipped suppliers feature (gap #4).

## Goals (confirmed with user)

- Stock receiving stays **one product at a time**, exactly as today — no
  multi-line/batch invoice screen. If a paper invoice covers 5 products,
  the merchant repeats the existing "استلام" action 5 times, optionally
  typing the same invoice number each time.
- Supplier and invoice number are **both optional and independent** on every
  receipt — receiving without either works exactly as it does today.
- When a supplier **is** selected, a payment method is required: **نقداً**
  (paid on the spot — records a purchase *and* an immediate matching
  payment in the supplier's ledger, net zero balance change but full
  history preserved) or **آجل** (credit — records only the purchase,
  raising what's owed; settled later through the existing "تسجيل دفعة"
  action on the supplier detail screen).
- The new supplier/invoice/payment fields are **admin-only**. A cashier
  sees the exact same receiving form as today (quantity + cost only) — no
  behavior change for that role.

## Data model

New table, following this repo's established append-only-audit-table
pattern (`stock_damages`, `stock_reconciliations`): every receipt is
recorded here regardless of whether a supplier was attached, giving a
permanent, queryable record — unlike today, where the only trace is a free-text
`operations_log` description.

```sql
create table stock_purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  total_cost numeric(12, 2) not null check (total_cost >= 0),
  supplier_id uuid references suppliers (id) on delete set null,
  invoice_number text,
  payment_method text check (payment_method in ('cash', 'credit')),
  actor_id uuid references profiles (id) on delete set null,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now(),
  constraint stock_purchases_payment_method_requires_supplier
    check (
      (supplier_id is null and payment_method is null)
      or (supplier_id is not null and payment_method is not null)
    )
);

create index stock_purchases_product_id_idx on stock_purchases (product_id);
create index stock_purchases_supplier_id_idx on stock_purchases (supplier_id);
create index stock_purchases_store_id_idx on stock_purchases (store_id);
create index stock_purchases_created_at_idx on stock_purchases (created_at);

alter table stock_purchases enable row level security;

create policy "authenticated read stock_purchases" on stock_purchases for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert stock_purchases" on stock_purchases for insert to authenticated
  with check (store_id = current_store_id());
```

`quantity`/`cost_price` are in the same base-unit terms `products.quantity`/
`cost_price` already use (i.e. already converted from the purchased pack
unit by the caller, same as `receive_product_stock`'s own parameters).
`total_cost = quantity * cost_price`, rounded to 2 decimals — denormalized
so a report/UI never has to recompute it. The CHECK constraint makes the
"payment method only makes sense with a supplier" rule a DB-level
guarantee, not just a UI convention.

`supplier_transactions` (from the suppliers feature) gets one new nullable
column, mirroring how `customer_transactions.sale_id` already links a
credit sale's ledger row back to the sale that created it:

```sql
alter table supplier_transactions add column if not exists stock_purchase_id uuid references stock_purchases (id) on delete set null;
create index if not exists supplier_transactions_stock_purchase_id_idx on supplier_transactions (stock_purchase_id);
```

Migration file: `supabase/migrations/00000000000017_stock_purchase_supplier_link.sql`
(next number after `00000000000016_suppliers.sql`).

## Ledger integration logic

No change to the `receive_product_stock` RPC itself (it stays focused and
atomic on the quantity/cost-price math, same reasoning as always — a
concurrent sale/scan must never race with it). The new inserts happen as
follow-up steps in the service layer, same non-transactional
multi-insert pattern already used for `sales` + `sale_items` and for the
credit-sale ledger row in `sales.service.ts`:

1. `receive_product_stock` runs exactly as today (updates `products`).
2. A `stock_purchases` row is always inserted — this is the permanent
   receipt record, present whether or not a supplier was attached.
3. **Only if a supplier was selected:**
   - Insert a `supplier_transactions` row: `type: 'purchase'`,
     `amount: total_cost`, `note` containing the invoice number (if any)
     and product/quantity for context, `stock_purchase_id` set to the new
     row's id.
   - **If `payment_method === 'cash'`:** immediately insert a second
     `supplier_transactions` row, `type: 'payment'`, same `amount` and
     `stock_purchase_id` — net effect on the balance is zero, but both
     the debt and its settlement are visible in the supplier's ledger
     history.
   - **If `payment_method === 'credit'`:** only the `purchase` row is
     inserted — the supplier's balance rises by `total_cost`, to be paid
     down later via the existing `recordSupplierPayment` flow.

These `supplier_transactions` rows are inserted directly (not through
`recordSupplierPurchase`/`recordSupplierPayment`), and are **not**
separately audit-logged with `supplier_purchase_recorded`/
`supplier_payment_recorded` — this mirrors the established precedent in
`sales.service.ts`, where a credit sale's `customer_transactions` row is
inserted directly rather than routed through
`customers.service.ts#recordPayment`, to avoid a redundant audit-log entry
that would misrepresent an automatic side-effect as a manual entry. The
existing `stock_received` operations-log entry (from `recordStockPurchase`)
is extended to mention the supplier/invoice when present — that remains
the one audit-trail line for the whole receiving action.

## Service layer

`services/products.service.ts#recordStockPurchase`'s params gain three
optional fields:

```ts
supplierId?: string | null;
invoiceNumber?: string | null;
paymentMethod?: "cash" | "credit" | null;
```

Validation: if `supplierId` is set but `paymentMethod` is not, throw
`"يجب تحديد طريقة الدفع عند اختيار مورد"` before any DB write (mirrors this
file's existing validate-first style). No new exported functions —
`recordStockPurchase` remains the single entry point the UI calls, now
importing `SupplierTransactionType` from `@/types/database.types` for the
two conditional inserts described above.

`types/product.ts` gains:

```ts
export type StockPurchase = Database["public"]["Tables"]["stock_purchases"]["Row"];
export type StockPurchaseInsert = Database["public"]["Tables"]["stock_purchases"]["Insert"];
```

`types/database.types.ts` (hand-authored, per this repo's convention) gets
a new `stock_purchases` table entry, and `supplier_transactions`'s
Row/Insert/Update gain `stock_purchase_id: string | null`.

## UI

`components/features/inventory/ReceiveStockForm.tsx` (the only place this
flow is triggered, per-product from the inventory screen) is extended, not
replaced:

- Reads `role` from `useAuth()` alongside the existing `user`/`storeId`.
- **Cashier (`role !== "admin"`):** form is pixel-identical to today —
  purchase unit, quantity, cost per unit. No new fields, no new data
  fetched.
- **Admin:** three additional fields appear below the existing ones:
  - **المورد** — a plain `<select>` populated by `listSuppliers(supabase)`
    (fetched once when the form mounts, admin-only), with a "بدون مورد"
    default option. A native select is the right minimal choice here
    (matches this same file's existing "وحدة الشراء" `<select>`) — a
    store's supplier list is short, unlike the product search
    `SupplierProductPicker` needed for the suppliers feature.
  - **رقم الفاتورة (اختياري)** — free-text `Input`, always enabled
    regardless of whether a supplier is chosen.
  - **طريقة الدفع** — a two-option toggle (نقداً / آجل), rendered **only**
    once a supplier is selected; resets to unset if the supplier selection
    is cleared back to "بدون مورد".
- On submit, the three new values are passed through to
  `recordStockPurchase` alongside the existing params.

## Testing

- `services/products.service.test.ts` (existing file) gains cases for
  `recordStockPurchase`: rejects a supplier without a payment method;
  inserts a `stock_purchases` row on every call regardless of supplier;
  with a supplier + `cash`, inserts both a `purchase` and a `payment`
  `supplier_transactions` row with matching `stock_purchase_id`; with a
  supplier + `credit`, inserts only the `purchase` row; with no supplier,
  inserts no `supplier_transactions` rows at all.
- `npm run typecheck && npm run lint && npm run test && npm run build`
  must all pass.
- Manual: as a cashier, confirm the receiving form is unchanged. As an
  admin, receive stock with no supplier (confirm nothing changes in
  `/suppliers`); receive stock choosing a supplier + نقداً (confirm the
  supplier's balance is unchanged but both a purchase and payment line
  appear in its ledger, invoice number visible in the note); receive stock
  choosing a supplier + آجل (confirm the balance rises by the correct
  amount); settle that debt via the existing "تسجيل دفعة" action and
  confirm it works unchanged.
