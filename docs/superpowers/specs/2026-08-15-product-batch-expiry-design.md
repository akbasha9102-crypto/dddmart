# Product Batch / Expiry Tracking — Design

## Problem

There's no expiry-date field anywhere in the codebase — not on `products`, not on any batch/lot concept. For a store selling perishables (dairy, canned goods, bread), this means no advance warning before stock expires, which translates directly into avoidable losses. This was gap #6 in `docs/gaps-analysis.md`.

## Goals (confirmed with user)

- Track expiry **per batch**, not per product: the same product can arrive at different times with different expiry dates, and older stock can still be on the shelf when a newer batch comes in.
- Batches are entered at the moment of **stock receiving** — the same screen already extended for suppliers/invoices.
- Batches are **not** linked to sale/return/damage/reconciliation stock deduction. The system has no way to know which physical batch a sold unit came from without rewriting stock deduction everywhere it happens (POS, returns, damage, reconciliation) — explicitly out of scope. A batch's `quantity` therefore means **quantity received**, not "quantity currently on the shelf." Staff clear a batch manually from the alerts list once it's sold through or discarded.
- A "قريبة الصلاحية" (near-expiry) list surfaces batches expiring within **30 days** (fixed, not configurable this phase), mirroring the existing low-stock-count pattern already on the inventory page.
- Both admin and cashier can enter an expiry date while receiving stock, and both can view/clear the alerts list — this is operational housekeeping, not the financial data that's admin-only (suppliers/invoices/payment).

## Data model

New table, following this repo's established pattern (`stock_damages`, `stock_purchases`): denormalized `product_name` so historical display survives a product rename, `product_id` nullable-on-delete since it's informational, not financial history.

```sql
create table product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete cascade,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  expiry_date date not null,
  received_at timestamptz not null default now(),
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);

create index product_batches_product_id_idx on product_batches (product_id);
create index product_batches_store_id_idx on product_batches (store_id);
create index product_batches_expiry_date_idx on product_batches (expiry_date);

alter table product_batches enable row level security;

create policy "authenticated read product_batches" on product_batches for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert product_batches" on product_batches for insert to authenticated
  with check (store_id = current_store_id());

create policy "authenticated delete product_batches" on product_batches for delete to authenticated
  using (store_id = current_store_id());
```

Unlike `stock_purchases`/`stock_damages` (append-only, no delete policy), `product_batches` explicitly allows delete — batches are working records staff clear once handled, not permanent financial/audit history. No update policy: a batch is either present or cleared, never edited in place. `product_id` uses `on delete cascade` rather than `set null` (the `stock_damages` convention) because a batch has zero standalone value once its product is gone — it's a pure alerting aid, not a record anyone would want to keep dangling.

`quantity` is in the same base-unit terms as `products.quantity`/`stock_purchases.quantity` — the quantity received in this batch, converted from the purchased-pack unit by the caller, same convention already established.

Migration file: `supabase/migrations/00000000000018_product_batches.sql` (next number after `00000000000017_stock_purchase_supplier_link.sql`).

## Integration with stock receiving

`services/products.service.ts#recordStockPurchase` gains one more optional param: `expiryDate?: string | null` (an ISO date string, `YYYY-MM-DD`). If present, after the existing `stock_purchases`/`supplier_transactions` logic, one more row is inserted directly:

```sql
insert into product_batches (product_id, product_name, quantity, expiry_date, store_id)
values (...)
```

No audit-log entry is added specifically for the batch (same reasoning as `supplier_products` linking — routine data entry, not a financial/security event); the existing `stock_received` operations-log description gains an additional short clause when an expiry date was given, alongside the existing supplier/invoice clause.

## Service layer

New `services/batches.service.ts` (mirrors `services/damages.service.ts`'s dedicated-file-per-inventory-concern shape):

- `listExpiringBatches(supabase, options?: { withinDays?: number })` — defaults `withinDays` to 30, returns all batches with `expiry_date <= today + withinDays`, joined with the product (name, for display — batches already denormalize `product_name` but the full product row is useful for e.g. a barcode link later), ordered soonest-expiry-first.
- `deleteBatch(supabase, id)` — clears a batch. No `actorId`/`storeId`/audit-log params needed: RLS already scopes the delete to the caller's store, and per the design above this isn't audit-logged.

`types/product.ts` gains:

```ts
export type ProductBatch = Database["public"]["Tables"]["product_batches"]["Row"];
export type ProductBatchInsert = Database["public"]["Tables"]["product_batches"]["Insert"];

export interface ProductBatchWithProduct extends ProductBatch {
  product: Product;
}

export function daysUntilExpiry(expiryDate: string): number {
  // whole days between today (local midnight) and expiryDate
}
```

`types/database.types.ts` (hand-authored) gets a new `product_batches` table entry.

## UI

**`components/features/inventory/ReceiveStockForm.tsx`** (extended again, third time now): one more field, **"تاريخ الصلاحية (اختياري)"** — a plain `<Input type="date">`, placed right after the cost-per-unit field and *before* the admin-only supplier block (since, unlike supplier/invoice/payment, this field is visible to both admin and cashier). Submits as `expiryDate: expiryDateInput || null` regardless of role.

**`app/(dashboard)/inventory/page.tsx`**: one more count fetched alongside the existing `lowStockCount` (`listExpiringBatches(supabase)`, default 30-day window), rendered as a second banner line matching the existing style:

```tsx
{expiringBatchesCount > 0 ? (
  <Link href="/inventory/expiry" className="mt-1 block text-sm text-red-600">
    {expiringBatchesCount} دفعة قريبة من الصلاحية
  </Link>
) : null}
```

**New page `app/(dashboard)/inventory/expiry/page.tsx`** (sibling to the existing `/inventory/add` sub-route): lists all near-expiry batches (product name, quantity, expiry date, days remaining via `daysUntilExpiry`, color-coded — red under 7 days, orange under 30), each with a "حذف" button calling `deleteBatch` and refreshing the list. No admin gate — both roles can reach and use this page, matching the receiving-form field's visibility.

## Testing

- `services/products.service.test.ts` — extend `recordStockPurchase`'s tests: with an `expiryDate`, inserts a `product_batches` row with the right `quantity`/`expiry_date`; with no `expiryDate`, never touches `product_batches`.
- `services/batches.service.test.ts` (new) — `listExpiringBatches` respects the `withinDays` cutoff and ordering; `deleteBatch` calls delete scoped by id.
- `npm run typecheck && npm run lint && npm run test && npm run build` must all pass.
- Manual: receive stock with an expiry date 10 days out, confirm the inventory page banner shows it and `/inventory/expiry` lists it with the right days-remaining; receive stock with no expiry date, confirm nothing changes; delete a batch from the alerts list and confirm it disappears and the count drops; confirm a cashier login can do all of the above (no admin gate on this feature).
