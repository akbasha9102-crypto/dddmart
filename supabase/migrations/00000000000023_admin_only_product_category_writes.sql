-- Admin-only product/category edits and deletes — fixes audit items 3.1 and
-- 4.2 (mashee_mart_audit_report.md).
--
-- 3.1 / 4.2: RLS on `products` was a single `for all` policy, and RLS on
-- `categories` (already split into select/insert/update/delete in
-- 00000000000012_multi_tenancy_foundation.sql) had no role distinction on
-- any of its four policies. In both cases any authenticated user in the
-- store — cashier included — could bypass the UI entirely and call the
-- Supabase client directly to UPDATE or DELETE any product or category,
-- even though the UI only shows edit/delete controls conditionally in some
-- places and not at all in others.
--
-- Confirmed business decision (already final — do not re-litigate):
-- cashiers may INSERT new products and categories (needed for the existing
-- "quick add" flow), but editing or deleting either is admin-only.
--
-- Both deleteProduct (services/products.service.ts) and deleteCategory
-- (services/categories.service.ts) are soft-deletes implemented as
-- `update ... set is_active = false` — grepped the whole app and confirmed
-- there is no real SQL DELETE issued anywhere against either table. So in
-- practice "edit" and "delete" are both enforced by the UPDATE policy below;
-- the DELETE policy is currently unreachable dead code from the app's own
-- UI, but is still hardened here for defense-in-depth and consistency with
-- categories, which already had a dedicated delete policy before this
-- migration.
--
-- Reuses the exact inline admin-check pattern already established in
-- 00000000000015_store_contact_info.sql and
-- 00000000000018_cash_drawer_shifts.sql —
-- `exists (select 1 from profiles where id = auth.uid() and role = 'admin')`
-- — rather than introducing a new helper function, for consistency with
-- those migrations.

-- ============================================================================
-- products: split the single "for all" policy into 4, admin-gating
-- update/delete only. select/insert remain open to any authenticated
-- same-store user (cashiers still need both: select for the POS/inventory
-- screens, insert for the "quick add product" flow).
-- ============================================================================

drop policy if exists "authenticated all products" on products;

create policy "authenticated select products" on products for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert products" on products for insert to authenticated
  with check (store_id = current_store_id());

create policy "admin update products" on products for update to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin delete products" on products for delete to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================================
-- categories: leave select/insert exactly as-is (still cashier-writable —
-- confirmed business decision), add the same admin check to update/delete
-- only.
-- ============================================================================

drop policy if exists "authenticated update categories" on categories;
create policy "admin update categories" on categories for update to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "authenticated delete categories" on categories;
create policy "admin delete categories" on categories for delete to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================================
-- adjust_product_stock: convert to security definer + manual tenant check.
--
-- Without this change, the moment the products UPDATE policy above becomes
-- admin-only, adjust_product_stock silently breaks for every cashier
-- scan/checkout/held-sale-cancel/return-restock/reconciliation, because it
-- is currently `security invoker` and relies entirely on the caller's own
-- RLS to make its `update products set quantity = ... where id = ...`
-- match a row. Under RLS, a cashier's session would no longer be able to
-- see/update the products row at all, so the UPDATE would match zero rows
-- — and this function's own documented contract is "zero rows returned
-- means insufficient stock, not an error" (services/products.service.ts
-- #decrementStock/#incrementStock, services/reconciliations.service.ts).
-- Every cashier sale/scan would appear to fail as a fake "out of stock"
-- error, with nothing distinguishing it from real insufficient-stock.
--
-- Fix mirrors the precedent set by record_return in
-- 00000000000021_atomic_return_recording.sql: security definer (bypasses
-- RLS) plus an explicit manual store_id check that replaces what RLS was
-- providing, so a cross-tenant call is still rejected even though RLS
-- itself no longer runs inside this function. Unlike record_return, no row
-- lock is needed here — this function's own atomicity guarantee has always
-- come from the single `update ... where id = p_product_id and
-- quantity + p_delta >= 0` statement (atomic under Postgres's row-level
-- locking during the UPDATE itself), not from an explicit `for update`
-- pre-lock, and that must NOT change: it's the entire reason this function
-- is safe against concurrent scans in the first place.
--
-- The empty-result-means-insufficient-stock contract is preserved exactly:
-- the WHERE clause guard (quantity + p_delta >= 0) is untouched, so a
-- request that would drive stock negative still returns zero rows, exactly
-- as before. The only behavior added is that a cross-tenant p_product_id
-- (a product belonging to a different store than the caller's) now raises
-- an exception instead of silently matching zero rows under RLS — strictly
-- more informative than before, and not a real-world case any legitimate
-- caller triggers today (every caller resolves p_product_id from its own
-- RLS-scoped SELECT first).
create or replace function public.adjust_product_stock(p_product_id uuid, p_delta integer)
returns setof products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_store_id uuid;
begin
  select store_id into v_product_store_id from products where id = p_product_id;

  if not found then
    return;
  end if;

  if v_product_store_id <> current_store_id() then
    raise exception 'المنتج لا يتبع هذا المتجر';
  end if;

  return query
    update products
    set quantity = quantity + p_delta,
        updated_at = now()
    where id = p_product_id
      and quantity + p_delta >= 0
    returning *;
end;
$$;

grant execute on function public.adjust_product_stock(uuid, integer) to authenticated;
