-- Stock Reconciliation (تسوية الجرد).
--
-- Append-only audit table (no update/delete policy) — a reconciliation,
-- once recorded, is corrected only by another reconciliation, never
-- edited. previous_quantity/counted_quantity/unit/cost_price are
-- snapshots at reconciliation time (same rationale as
-- stock_damages.cost_price). difference = counted_quantity -
-- previous_quantity (negative = shortage, positive = overage).
-- loss_value is only populated for a shortage (abs(difference) *
-- cost_price) — an overage corrects the quantity but is never treated
-- as profit, so loss_value stays 0 for it.
create table stock_reconciliations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  unit text not null,
  previous_quantity integer not null,
  counted_quantity integer not null check (counted_quantity >= 0),
  difference integer not null,
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  loss_value numeric(12, 2) not null default 0 check (loss_value >= 0),
  reason text,
  actor_id uuid references profiles (id) on delete set null,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);

create index stock_reconciliations_created_at_idx on stock_reconciliations (created_at);
create index stock_reconciliations_product_id_idx on stock_reconciliations (product_id);
create index stock_reconciliations_store_id_idx on stock_reconciliations (store_id);

alter table stock_reconciliations enable row level security;

create policy "authenticated read stock_reconciliations" on stock_reconciliations for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert stock_reconciliations" on stock_reconciliations for insert to authenticated
  with check (store_id = current_store_id());
