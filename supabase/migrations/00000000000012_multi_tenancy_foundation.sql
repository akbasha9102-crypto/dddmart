-- Multi-Tenancy Data Foundation (Phase 1 of 3).
--
-- Turns dddmart from a single-implicit-tenant app into a multi-store one:
-- every table gets a store_id, every "using (true)" RLS policy becomes
-- "store_id = current_store_id()", and the real live client's existing data
-- becomes "store #1" (fixed, pre-chosen id below — not gen_random_uuid() —
-- so it's reproducible and reviewable). See
-- docs/superpowers/specs/2026-08-08-multi-tenancy-foundation-design.md for
-- the full design and rationale.
--
-- This whole file runs as a single transaction (standard Supabase migration
-- behavior) — the risky part (step 6, cutting RLS over) either fully
-- succeeds or fully rolls back with the live app untouched mid-flight.
--
-- Constraint names used in `drop constraint if exists` below are
-- best-guesses at Postgres's default auto-generated naming convention
-- (<table>_<column(s)>_key for unique constraints). They were not verified
-- against the live schema (no DB access while writing this migration) —
-- `if exists` makes this safe either way: if the guessed name is wrong,
-- the drop is a no-op and the subsequent `add constraint` still creates
-- the correct composite constraint. Double-check the guessed names against
-- the real schema when this migration is actually applied.

-- ============================================================================
-- Step 1: Create `stores`, insert "store #1" for the real live client.
-- ============================================================================

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into stores (id, name, slug, is_active)
values ('7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec', 'DDD Mart', 'ddd-mart', true)
on conflict (id) do nothing;

-- ============================================================================
-- Step 2: Add store_id to all 12 tables as nullable — no RLS changes yet.
-- Safe to stop here: the live app doesn't reference store_id anywhere yet.
-- ============================================================================

alter table profiles add column if not exists store_id uuid references stores (id);
alter table categories add column if not exists store_id uuid references stores (id);
alter table products add column if not exists store_id uuid references stores (id);
alter table sales add column if not exists store_id uuid references stores (id);
alter table sale_items add column if not exists store_id uuid references stores (id);
alter table product_units add column if not exists store_id uuid references stores (id);
alter table operations_log add column if not exists store_id uuid references stores (id);
alter table returns add column if not exists store_id uuid references stores (id);
alter table stock_damages add column if not exists store_id uuid references stores (id);
alter table held_sales add column if not exists store_id uuid references stores (id);
alter table customers add column if not exists store_id uuid references stores (id);
alter table customer_transactions add column if not exists store_id uuid references stores (id);

-- ============================================================================
-- Step 3: Backfill every existing row to store #1's id. Today's data is
-- genuinely single-tenant, so this is unconditionally correct.
-- ============================================================================

update profiles set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update categories set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update products set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update sales set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update sale_items set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update product_units set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update operations_log set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update returns set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update stock_damages set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update held_sales set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update customers set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;
update customer_transactions set store_id = '7cda2359-3b9e-4a52-aaf0-e1ea0bc8b4ec' where store_id is null;

-- ============================================================================
-- Step 4: Verify no nulls remain before tightening to NOT NULL.
-- Not a separate SQL check — the "alter column ... set not null" statements
-- in step 5 fail loudly (and roll back the whole transaction) if any row
-- anywhere was missed by the backfill above, which is the actual safety net.
-- ============================================================================

-- ============================================================================
-- Step 5: Tighten store_id to NOT NULL, add per-store uniqueness
-- constraints, rescope the barcode-uniqueness trigger functions.
-- ============================================================================

alter table profiles alter column store_id set not null;
alter table categories alter column store_id set not null;
alter table products alter column store_id set not null;
alter table sales alter column store_id set not null;
alter table sale_items alter column store_id set not null;
alter table product_units alter column store_id set not null;
alter table operations_log alter column store_id set not null;
alter table returns alter column store_id set not null;
alter table stock_damages alter column store_id set not null;
alter table held_sales alter column store_id set not null;
alter table customers alter column store_id set not null;
alter table customer_transactions alter column store_id set not null;

create index if not exists profiles_store_id_idx on profiles (store_id);
create index if not exists categories_store_id_idx on categories (store_id);
create index if not exists products_store_id_idx on products (store_id);
create index if not exists sales_store_id_idx on sales (store_id);
create index if not exists sale_items_store_id_idx on sale_items (store_id);
create index if not exists product_units_store_id_idx on product_units (store_id);
create index if not exists operations_log_store_id_idx on operations_log (store_id);
create index if not exists returns_store_id_idx on returns (store_id);
create index if not exists stock_damages_store_id_idx on stock_damages (store_id);
create index if not exists held_sales_store_id_idx on held_sales (store_id);
create index if not exists customers_store_id_idx on customers (store_id);
create index if not exists customer_transactions_store_id_idx on customer_transactions (store_id);

-- products.barcode: global unique -> per-store unique.
alter table products drop constraint if exists products_barcode_key;
alter table products add constraint products_store_id_barcode_key unique (store_id, barcode);

-- product_units.barcode: global unique -> per-store unique.
alter table product_units drop constraint if exists product_units_barcode_key;
alter table product_units add constraint product_units_store_id_barcode_key unique (store_id, barcode);

-- sales.invoice_number: global unique -> per-store unique.
alter table sales drop constraint if exists sales_invoice_number_key;
alter table sales add constraint sales_store_id_invoice_number_key unique (store_id, invoice_number);

-- Rescope the cross-table barcode-uniqueness triggers (products <->
-- product_units) to compare within the same store only — two different
-- stores legitimately stocking the same manufacturer barcode is normal.
create or replace function public.check_product_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from product_units
    where barcode = new.barcode
      and store_id = new.store_id
  ) then
    raise exception 'الباركود مستخدم من قبل بوحدة منتج أخرى' using errcode = '23505';
  end if;
  return new;
end;
$$;

create or replace function public.check_unit_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from products
    where barcode = new.barcode
      and store_id = new.store_id
  ) then
    raise exception 'الباركود مستخدم من قبل منتج آخر' using errcode = '23505';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- Step 6: Cut over RLS — replace every "using (true)" policy with
-- "store_id = current_store_id()" (same transaction as step 5: all green
-- or all rolled back, no partially-migrated state the live app could hit).
-- ============================================================================

create or replace function public.current_store_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select store_id from public.profiles where id = auth.uid();
$$;

-- profiles ------------------------------------------------------------------
-- Read: still every authenticated user can read profiles, but now scoped to
-- their own store only (was: everyone reads every profile in the system).
drop policy if exists "authenticated read profiles" on profiles;
create policy "authenticated read profiles" on profiles for select to authenticated
  using (store_id = current_store_id());

-- Self-update: closes the pre-existing gap (no with check at all) AND locks
-- store_id from being self-editable, so a cashier can never hop stores by
-- rewriting their own profile row's store_id.
drop policy if exists "self update profile" on profiles;
create policy "self update profile" on profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id and store_id = current_store_id());

-- categories ------------------------------------------------------------------
drop policy if exists "authenticated read categories" on categories;
create policy "authenticated read categories" on categories for select to authenticated
  using (store_id = current_store_id());

drop policy if exists "authenticated insert categories" on categories;
create policy "authenticated insert categories" on categories for insert to authenticated
  with check (store_id = current_store_id());

drop policy if exists "authenticated update categories" on categories;
create policy "authenticated update categories" on categories for update to authenticated
  using (store_id = current_store_id()) with check (store_id = current_store_id());

drop policy if exists "authenticated delete categories" on categories;
create policy "authenticated delete categories" on categories for delete to authenticated
  using (store_id = current_store_id());

-- products ------------------------------------------------------------------
drop policy if exists "authenticated all products" on products;
create policy "authenticated all products" on products for all to authenticated
  using (store_id = current_store_id()) with check (store_id = current_store_id());

-- sales ------------------------------------------------------------------
drop policy if exists "authenticated all sales" on sales;
create policy "authenticated all sales" on sales for all to authenticated
  using (store_id = current_store_id()) with check (store_id = current_store_id());

-- sale_items ------------------------------------------------------------------
drop policy if exists "authenticated all sale_items" on sale_items;
create policy "authenticated all sale_items" on sale_items for all to authenticated
  using (store_id = current_store_id()) with check (store_id = current_store_id());

-- product_units ------------------------------------------------------------------
drop policy if exists "authenticated all product_units" on product_units;
create policy "authenticated all product_units" on product_units for all to authenticated
  using (store_id = current_store_id()) with check (store_id = current_store_id());

-- operations_log ------------------------------------------------------------------
drop policy if exists "authenticated read operations_log" on operations_log;
create policy "authenticated read operations_log" on operations_log for select to authenticated
  using (store_id = current_store_id());

drop policy if exists "authenticated insert operations_log" on operations_log;
create policy "authenticated insert operations_log" on operations_log for insert to authenticated
  with check (store_id = current_store_id());

-- returns ------------------------------------------------------------------
drop policy if exists "authenticated read returns" on returns;
create policy "authenticated read returns" on returns for select to authenticated
  using (store_id = current_store_id());

drop policy if exists "authenticated insert returns" on returns;
create policy "authenticated insert returns" on returns for insert to authenticated
  with check (store_id = current_store_id());

-- stock_damages ------------------------------------------------------------------
drop policy if exists "authenticated read stock_damages" on stock_damages;
create policy "authenticated read stock_damages" on stock_damages for select to authenticated
  using (store_id = current_store_id());

drop policy if exists "authenticated insert stock_damages" on stock_damages;
create policy "authenticated insert stock_damages" on stock_damages for insert to authenticated
  with check (store_id = current_store_id());

-- held_sales ------------------------------------------------------------------
drop policy if exists "authenticated read held_sales" on held_sales;
create policy "authenticated read held_sales" on held_sales for select to authenticated
  using (store_id = current_store_id());

drop policy if exists "authenticated insert held_sales" on held_sales;
create policy "authenticated insert held_sales" on held_sales for insert to authenticated
  with check (store_id = current_store_id());

drop policy if exists "authenticated delete held_sales" on held_sales;
create policy "authenticated delete held_sales" on held_sales for delete to authenticated
  using (store_id = current_store_id());

-- customers ------------------------------------------------------------------
drop policy if exists "authenticated all customers" on customers;
create policy "authenticated all customers" on customers for all to authenticated
  using (store_id = current_store_id()) with check (store_id = current_store_id());

-- customer_transactions ------------------------------------------------------------------
drop policy if exists "authenticated all customer_transactions" on customer_transactions;
create policy "authenticated all customer_transactions" on customer_transactions for all to authenticated
  using (store_id = current_store_id()) with check (store_id = current_store_id());

-- ============================================================================
-- Step 7: Update the new-employee trigger and first-admin-per-store logic
-- (same transaction) — no window where a new hire could land with a blank
-- store. store_id is passed through raw_user_meta_data (same channel
-- full_name already uses) since the trigger has no other way to know which
-- store a brand-new auth.users row belongs to.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  assigned_role text;
  target_store_id uuid;
begin
  target_store_id := (new.raw_user_meta_data ->> 'store_id')::uuid;

  if not exists (select 1 from public.profiles where store_id = target_store_id) then
    assigned_role := 'admin';
  else
    assigned_role := 'cashier';
  end if;

  insert into public.profiles (id, full_name, role, store_id)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), assigned_role, target_store_id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;
