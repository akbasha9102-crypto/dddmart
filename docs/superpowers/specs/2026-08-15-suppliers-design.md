# Suppliers (الموردون) — Design

## Problem

There is no way to track suppliers in dddmart today. The merchant deals with
several suppliers, needs to know which supplier(s) can provide each product,
and needs to track a running account (debts owed, payments made) with each
one — currently done on paper. This was gap #4 in `docs/gaps-analysis.md`
("لا يوجد جدول موردين ولا ربط بالمنتجات").

## Goals (confirmed with user)

- A supplier record: name, phone, address, note, and an **opening balance**
  (existing debt from before the system was used).
- A product can be supplied by **more than one supplier** (many-to-many),
  optionally with a different purchase cost per supplier.
- A per-supplier account ledger: purchase invoices and payments entered
  **manually** (not wired to the inventory-receiving flow — that's a
  separate, later gap-list item and explicitly out of scope here).
- Suppliers management (add/edit supplier, record purchase/payment, link
  products) is **admin-only**, unlike customers which cashiers can also
  manage.

## Data model

Three new tables, following this repo's existing append-only-ledger pattern
(`customer_transactions`, `stock_reconciliations`, `stock_damages`) and its
multi-tenancy convention (every table carries `store_id`, RLS scoped by
`current_store_id()`):

```sql
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  note text,
  opening_balance numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_store_id_idx on suppliers (store_id);
create index if not exists suppliers_name_idx on suppliers (name);

create table if not exists supplier_transactions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id) on delete cascade,
  type text not null check (type in ('purchase', 'payment')),
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);

create index if not exists supplier_transactions_supplier_id_idx on supplier_transactions (supplier_id);
create index if not exists supplier_transactions_store_id_idx on supplier_transactions (store_id);
create index if not exists supplier_transactions_created_at_idx on supplier_transactions (created_at);

create table if not exists supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  cost_price numeric(12, 2),
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now(),
  unique (supplier_id, product_id)
);

create index if not exists supplier_products_supplier_id_idx on supplier_products (supplier_id);
create index if not exists supplier_products_product_id_idx on supplier_products (product_id);
create index if not exists supplier_products_store_id_idx on supplier_products (store_id);
```

`cost_price` on `supplier_products` is nullable: if a supplier's price isn't
recorded, the UI falls back to displaying the product's own `cost_price`.
Deleting a supplier or a product cascades the join row away (it's a pure
mapping, not financial history — unlike `supplier_transactions`, which is
never deleted).

Migration file: `supabase/migrations/00000000000016_suppliers.sql` (next
number after `00000000000015_store_contact_info.sql`).

## Balance computation

Same reasoning as `customer_balances`: **never** a stored, mutable balance
column — a skipped or double write would silently desync it from reality.
Computed via a view, seeded from each supplier's `opening_balance` (a plain
editable field on the supplier record, not a ledger row — it represents
onboarding data, not a real-world purchase/payment event):

```sql
create or replace view supplier_balances as
select
  s.id as supplier_id,
  s.opening_balance
    + coalesce(sum(case when st.type = 'purchase' then st.amount else -st.amount end), 0)
    as balance
from suppliers s
left join supplier_transactions st on st.supplier_id = s.id
group by s.id, s.opening_balance;
```

The `left join` (starting from `suppliers`, not `supplier_transactions`)
guarantees every supplier has exactly one balance row, even with zero
transactions — needed since `opening_balance` can be non-zero from day one.
Balance = what the merchant owes the supplier; a `'purchase'` row increases
it, a `'payment'` row decreases it. This mirrors `customer_balances` exactly
except for the `opening_balance` seed term, which `customer_balances` has no
equivalent of.

As with `customer_balances`, the view carries no `store_id` column of its
own — filtering happens transparently because Postgres evaluates RLS on the
underlying `suppliers`/`supplier_transactions` tables for the querying role,
regardless of view ownership (confirmed already working in production for
`customer_balances`).

## RLS

Same store-isolation convention as every table added since multi-tenancy
(migration 12): policies check `store_id = current_store_id()`, no DB-level
role distinction. `supplier_transactions` is append-only (select + insert
only, matching `customer_transactions`/`stock_reconciliations`) since a
purchase or payment, once recorded, should be corrected by a new entry, not
edited or deleted. `suppliers` and `supplier_products` allow update (editing
supplier details, editing a per-supplier product cost) since they're
mutable records, not ledger history.

The "admin-only" restriction is enforced the same way it already is for
`/employees` and `/sales` (`role === "admin"` client-side check in the page
component, e.g. `lib/employees/adminCheck.ts`'s pattern) — **not** at the RLS
layer. This matches the existing convention for every other admin-gated page
in this repo (there is no DB-level role check anywhere today; `/employees`
also relies on this pattern plus a service-role API route for the one
mutation that must bypass RLS, which suppliers has no equivalent need for).

## Service layer

New `services/suppliers.service.ts` (same shape as `services/customers.service.ts`
— plain functions taking `SupabaseClient<Database>` first, `actorId` +
`storeId` last, for archive logging):

- `listSuppliers(supabase, storeId, { search }?)` — joins `supplier_balances` per row.
- `getSupplier(supabase, id)` — supplier + balance + full transaction history (newest first) + linked products (joined with `products` for name/barcode/stock).
- `createSupplier(supabase, { name, phone?, address?, note?, openingBalance? }, actorId, storeId)`.
- `updateSupplier(supabase, id, patch, actorId, storeId)` — edits name/phone/address/note/opening_balance.
- `archiveSupplier(supabase, id, actorId, storeId)` — soft delete via `is_active = false` (matches products/customers; ledger history is preserved, not deleted).
- `recordSupplierPurchase(supabase, { supplierId, amount, note }, actorId, storeId)` — inserts a `'purchase'` row (amount must be `> 0`).
- `recordSupplierPayment(supabase, { supplierId, amount, note }, actorId, storeId)` — validates `0 < amount <= currentBalance` (same cap `customers.service.ts#recordPayment` uses, preventing an accidental overpayment from putting a supplier's balance negative), inserts a `'payment'` row.
- `getSupplierBalance(supabase, supplierId)` — single-row read from the view.
- `linkSupplierProduct(supabase, { supplierId, productId, costPrice? }, actorId, storeId)` — upsert on `(supplier_id, product_id)`, so re-linking just updates the cost.
- `unlinkSupplierProduct(supabase, { supplierId, productId }, actorId, storeId)` — deletes the join row.

`types/database.types.ts` additions (hand-authored, per this repo's
convention): `Row`/`Insert`/`Update` interfaces for the three new tables, and:

```ts
export type OperationActionType =
  | /* ...existing... */
  | "supplier_created"
  | "supplier_updated"
  | "supplier_archived"
  | "supplier_purchase_recorded"
  | "supplier_payment_recorded";
export type OperationEntityType = /* ...existing... */ | "supplier";
export type SupplierTransactionType = "purchase" | "payment";
```

Linking/unlinking a product to a supplier is **not** separately audit-logged
(same as assigning a category to a product isn't) — it's routine
configuration, not a financial event.

## UI

New `/suppliers` page, added to `SETTINGS_LINKS` in
`components/shared/navLinks.ts` next to "المبيعات"/"الموظفون"
(`{ href: "/suppliers", label: "الموردون", adminOnly: true, icon: Truck }`),
and to `SETTINGS_PATHS`. The page itself follows the exact
`app/(dashboard)/employees/page.tsx` guard pattern (`role === "admin"` from
`useAuth()`, else a plain "هذي الصفحة للمالك فقط" message) — same as every
other admin-only page in the app.

`components/features/suppliers/`:

- **`SupplierList.tsx`** — search box, table/card list (name, phone, balance
  from `supplier_balances`), "+ إضافة مورد" button opening `SupplierForm`.
- **`SupplierForm.tsx`** — create/edit modal: name, phone, address, note,
  opening balance (editable both on create and later edit, since it's plain
  supplier data, not a locked ledger entry).
- **`SupplierDetail.tsx`** — mirrors `CustomerDetail.tsx`: current balance,
  full transaction history (date, type, amount, running balance), "تسجيل
  فاتورة شراء" and "تسجيل دفعة" actions (amount + optional note; payment
  capped at current balance same as the customer flow), and a linked-products
  section listing this supplier's products with their per-supplier cost,
  with add/remove.
- **`SupplierProductPicker.tsx`** — inline within `SupplierDetail`: search
  existing products by name/barcode, pick one, optionally set a cost price,
  call `linkSupplierProduct`.

Not built in this phase (explicitly out of scope, per the confirmed goals
above): no changes to `ProductForm`/inventory screens to show a product's
suppliers from the product side, and no link between this ledger and the
inventory stock-receiving flow. `getSupplierProducts`/`getProductSuppliers`
are written generically enough that a future "show suppliers on the product
page" feature could reuse them without a service-layer change.

## Testing

- `services/suppliers.service.test.ts` — CRUD, `recordSupplierPayment`
  amount validation (rejects `<= 0` and `> balance`), balance computation
  including a non-zero `opening_balance`, `linkSupplierProduct` upsert
  behavior (re-linking updates cost instead of erroring on the unique
  constraint), `unlinkSupplierProduct`.
- `npm run typecheck && npm run lint && npm run test && npm run build` must
  all pass.
- Manual: create a supplier with an opening balance, confirm it shows as the
  starting balance with zero transactions; record a purchase and a partial
  payment, confirm the balance updates correctly and can't be overpaid; link
  the same product to two different suppliers with different costs, confirm
  both appear independently on each supplier's product list; archive a
  supplier and confirm its transaction history is still visible (not
  deleted) and it drops out of the active supplier list.
