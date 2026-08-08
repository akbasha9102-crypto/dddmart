# Customer Debt Management (بيع بالآجل) — Design

## Problem

The store currently tracks credit sales ("دين"/"آجل") on paper. Debts get
lost, customers dispute balances, and there's no way to print a statement
when a customer comes in to settle. The client wants to fully replace the
paper ledger with an in-app customer file (name, phone, credit limit) that
POS checkout can post invoices against, plus a settlement flow with
printable statements.

## Goals (confirmed with user)

- A customer record: name, phone, credit limit (سقف الدين المسموح).
- At checkout, a cashier can choose "بيع بالآجل" to post the whole invoice to
  a customer's account instead of collecting cash.
- If the sale would push the customer over their credit limit: **warn only,
  still allow the sale to complete** (cashier's call, not a hard block).
- When a customer pays, the cashier can print a **كشف حساب** (statement of
  account) on the **same 80mm thermal receipt printer** already used for
  invoices (`ReceiptPrinter.tsx`), not A4.

## Data model

Two new tables, following this repo's existing append-only-ledger pattern
(`returns`, `stock_damages`, `held_sales` are all separate tables rather than
mutable status/balance columns on `sales`/`products`):

```sql
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  credit_limit numeric(12, 2) not null default 0 check (credit_limit >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists customers_name_idx on customers (name);

create table if not exists customer_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  type text not null check (type in ('sale', 'payment')),
  amount numeric(12, 2) not null check (amount > 0),
  sale_id uuid references sales (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists customer_transactions_customer_id_idx on customer_transactions (customer_id);
create index if not exists customer_transactions_created_at_idx on customer_transactions (created_at);
```

Balance is **computed, not stored**, via a view (same reasoning as the
returns/damages netting done in `sales.service.ts` — never trust a mutable
running total that a bug or a skipped write could desync):

```sql
create or replace view customer_balances as
select
  customer_id,
  coalesce(sum(case when type = 'sale' then amount else -amount end), 0) as balance
from customer_transactions
group by customer_id;
```

`sales` table changes (currently `payment_method text ... check (payment_method in ('cash'))`,
no customer link at all):

```sql
alter table sales drop constraint if exists sales_payment_method_check;
alter table sales add constraint sales_payment_method_check check (payment_method in ('cash', 'credit'));
alter table sales add column if not exists customer_id uuid references customers (id) on delete set null;
```

Migration file: `supabase/migrations/00000000000011_customer_debt_management.sql`
(next number after `00000000000010_hold_sale.sql`).

RLS: same repo-wide convention as every other table — any authenticated user
can read/write (`for all to authenticated using (true) with check (true)`).
No new role split; matches how categories/products/sales already work.

## Credit sale flow

At checkout, when `paymentMethod === 'credit'`:

- `paid_amount` is forced to `0`, `change_amount` is `0`, `total_amount` is
  the full invoice as usual, `customer_id` is set.
- After the `sales` row (and `sale_items`) are inserted — exactly like today
  — one `customer_transactions` row is inserted: `type: 'sale'`,
  `amount: total_amount`, `sale_id` set to the new sale's id. This mirrors
  the existing non-transactional multi-insert pattern already used for
  `sales` + `sale_items` (no DB-level transaction wrapping either step
  today), so no new atomicity primitive is introduced.
- Before finalizing, the UI reads the customer's current balance
  (`customer_balances` view) and compares `balance + cartTotal` against
  `credit_limit`. If over, show a non-blocking warning banner; the cashier
  can still complete the sale.

Settling a debt (`services/customers.service.ts#recordPayment`) inserts a
`customer_transactions` row with `type: 'payment'`. Payments are capped at
the customer's current balance (can't overpay into a negative balance) but
can be partial.

## Service layer

New `services/customers.service.ts` (same shape as existing services — plain
functions taking `SupabaseClient<Database>` first):

- `listCustomers(supabase, { search }?)` — joins `customer_balances` for each row.
- `getCustomer(supabase, id)` — customer + balance + full `customer_transactions` history, newest first.
- `createCustomer(supabase, { name, phone, creditLimit, notes })`
- `updateCustomer(supabase, id, patch)` — edit fields; `archiveCustomer` sets `is_active = false` (soft delete, matching the products/categories archive pattern).
- `recordPayment(supabase, { customerId, amount, note })` — validates `0 < amount <= currentBalance`, inserts the ledger row.
- `getCustomerBalance(supabase, customerId)` — single-row read from the view, used for the POS over-limit check.

`services/sales.service.ts#createSale` extended to accept an optional
`paymentMethod: 'cash' | 'credit'` and `customerId` on `CheckoutPayload`
(default `'cash'`, unchanged behavior when omitted). When `'credit'`, it
also inserts the `customer_transactions` row described above.

## POS UI changes

`app/(dashboard)/pos/page.tsx` checkout area:

- Payment method toggle: "نقد" / "بالآجل" (mirrors the existing barcode-mode
  toggle style already in this codebase).
- "بالآجل" selected → paid-amount input is replaced by a customer picker
  (search existing customers by name/phone, plus a "+ زبون جديد" inline
  quick-add form — same UX as the existing inline category quick-add in
  inventory). Selected customer's name, current balance, and credit limit
  are shown.
- Over-limit warning banner (non-blocking) as described above.
- `ReceiptPrinter.tsx` prints "بيع بالآجل" plus the customer's name instead
  of paid/change amounts when `payment_method === 'credit'`.

## New "الزبائن" page

`app/(dashboard)/customers/page.tsx`, added to `Sidebar`/`BottomNav`/Settings
links next to Employees/Sales (same nav pattern already in the repo):

- List: name, phone, balance (مديونية), credit limit, search box.
- Add/edit customer modal (mirrors the existing `ProductForm`/employee-form
  pattern).
- Customer detail view: full transaction history (date, type, amount,
  running balance), "تسديد دفعة" action (amount input, capped at current
  balance), "طباعة كشف حساب" button.
- New `CustomerStatementPrinter.tsx`, reusing `ReceiptPrinter.tsx`'s
  `@media print` 80mm-width pattern — a scrollable list of transactions plus
  a totals line, not the A4 layout.

## Testing

- `services/customers.service.test.ts` — CRUD, `recordPayment` amount
  validation (rejects `<= 0` and `> balance`), balance computation.
- Extend `services/sales.service.test.ts` for the credit-sale path (forces
  `paid_amount = 0`, inserts the ledger row, requires `customerId`).
- `npm run typecheck && npm run lint && npm run build` must all pass.
- Manual: create a customer with a small credit limit, ring up a credit sale
  that exceeds it, confirm the warning shows but the sale still completes;
  confirm the customer's balance updates on the customers page; record a
  partial payment and confirm the balance drops correctly; print a
  statement and confirm it renders at 80mm width like a receipt.
