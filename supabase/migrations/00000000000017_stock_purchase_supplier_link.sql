-- Links stock receiving to purchase invoices/suppliers (gap #5 in
-- docs/gaps-analysis.md, a follow-on to the suppliers feature in
-- migration 00000000000016).
--
-- stock_purchases: one row per receiving action, always recorded
-- regardless of whether a supplier was attached — a permanent,
-- queryable receipt, unlike the free-text operations_log entry that
-- was the only trace before this. quantity/cost_price are in the same
-- base-unit terms as products.quantity/cost_price (already converted
-- by the caller, same convention as receive_product_stock's own
-- parameters). total_cost = quantity * cost_price, denormalized so it
-- never needs recomputing. The CHECK constraint makes "payment_method
-- only makes sense with a supplier" a DB-level guarantee, not just a
-- UI/service-layer convention.
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

-- supplier_transactions: link a purchase/payment row back to the
-- stock_purchases receipt that created it, same idea as
-- customer_transactions.sale_id linking a credit sale's ledger row
-- back to the sale (migration 00000000000011).
alter table supplier_transactions add column if not exists stock_purchase_id uuid references stock_purchases (id) on delete set null;
create index if not exists supplier_transactions_stock_purchase_id_idx on supplier_transactions (stock_purchase_id);
