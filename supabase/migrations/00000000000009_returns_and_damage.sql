-- Returns & Damage Tracking.
--
-- Two append-only tables (no update/delete policy) — a return or damage
-- record, once made, is not corrected by editing it, only by making
-- another record. sale_item_id (not just sale_id) lets us compute
-- "already returned qty for this line" via sum(quantity) where
-- sale_item_id = X. returns.quantity is in the *original sale unit*
-- (matches sale_items.quantity semantics — direct comparison against
-- sale_item.quantity needs no conversion; conversion to base units
-- happens only when calling incrementStock). stock_damages.quantity is
-- always base-unit (matches products.quantity; no unit-picker for damage
-- — deliberate v1 scope reduction). stock_damages.cost_price is
-- snapshotted from products.cost_price at damage time (not live),
-- loss_amount stored redundantly (quantity * cost_price) for query
-- simplicity, matching sale_items.total_price already being stored
-- redundantly next to unit_price/quantity.

create table if not exists returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales (id) on delete cascade,
  sale_item_id uuid not null references sale_items (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_label text,
  unit_conversion_factor integer not null default 1,
  refund_amount numeric(12, 2) not null check (refund_amount >= 0),
  reason text,
  actor_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists returns_sale_item_id_idx on returns (sale_item_id);
create index if not exists returns_created_at_idx on returns (created_at);

create table if not exists stock_damages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  loss_amount numeric(12, 2) not null check (loss_amount >= 0),
  reason text,
  actor_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_damages_created_at_idx on stock_damages (created_at);
create index if not exists stock_damages_product_id_idx on stock_damages (product_id);

alter table returns enable row level security;
alter table stock_damages enable row level security;

create policy "authenticated read returns" on returns for select to authenticated using (true);
create policy "authenticated insert returns" on returns for insert to authenticated with check (true);

create policy "authenticated read stock_damages" on stock_damages for select to authenticated using (true);
create policy "authenticated insert stock_damages" on stock_damages for insert to authenticated with check (true);
