-- Suppliers (الموردون).
--
-- suppliers: one row per supplier, with an opening_balance seeding the
-- balance computation below (existing debt from before the system was
-- used — plain editable supplier data, not a locked ledger entry).
--
-- supplier_transactions: append-only ledger (no update/delete policy,
-- same convention as customer_transactions/stock_reconciliations) — a
-- 'purchase' increases what the merchant owes the supplier, a 'payment'
-- decreases it. Corrected only by a new entry, never edited.
--
-- supplier_products: many-to-many link between suppliers and products
-- (a product can have more than one supplier). cost_price is nullable —
-- when unset, the UI falls back to the product's own cost_price. Pure
-- mapping data (not financial history), so it cascade-deletes and is
-- not itself audit-logged.
create table suppliers (
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

create index suppliers_store_id_idx on suppliers (store_id);
create index suppliers_name_idx on suppliers (name);

alter table suppliers enable row level security;

create policy "authenticated read suppliers" on suppliers for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert suppliers" on suppliers for insert to authenticated
  with check (store_id = current_store_id());

create policy "authenticated update suppliers" on suppliers for update to authenticated
  using (store_id = current_store_id())
  with check (store_id = current_store_id());

create table supplier_transactions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id) on delete cascade,
  type text not null check (type in ('purchase', 'payment')),
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);

create index supplier_transactions_supplier_id_idx on supplier_transactions (supplier_id);
create index supplier_transactions_store_id_idx on supplier_transactions (store_id);
create index supplier_transactions_created_at_idx on supplier_transactions (created_at);

alter table supplier_transactions enable row level security;

create policy "authenticated read supplier_transactions" on supplier_transactions for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert supplier_transactions" on supplier_transactions for insert to authenticated
  with check (store_id = current_store_id());

create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  cost_price numeric(12, 2),
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now(),
  unique (supplier_id, product_id)
);

create index supplier_products_supplier_id_idx on supplier_products (supplier_id);
create index supplier_products_product_id_idx on supplier_products (product_id);
create index supplier_products_store_id_idx on supplier_products (store_id);

alter table supplier_products enable row level security;

create policy "authenticated read supplier_products" on supplier_products for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert supplier_products" on supplier_products for insert to authenticated
  with check (store_id = current_store_id());

create policy "authenticated update supplier_products" on supplier_products for update to authenticated
  using (store_id = current_store_id())
  with check (store_id = current_store_id());

create policy "authenticated delete supplier_products" on supplier_products for delete to authenticated
  using (store_id = current_store_id());

-- Balance is computed, never stored (same reasoning as customer_balances,
-- migration 00000000000011) — a skipped or double write to a mutable
-- column could silently desync it from reality. Starts from suppliers
-- (left join, not an inner group-by on supplier_transactions) so every
-- supplier has exactly one balance row even with zero transactions,
-- since opening_balance can already be non-zero on day one.
create or replace view supplier_balances as
select
  s.id as supplier_id,
  s.opening_balance
    + coalesce(sum(case when st.type = 'purchase' then st.amount else -st.amount end), 0)
    as balance
from suppliers s
left join supplier_transactions st on st.supplier_id = s.id
group by s.id, s.opening_balance;
