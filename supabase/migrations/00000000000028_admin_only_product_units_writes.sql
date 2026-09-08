-- Admin-only product_units writes — fixes audit item (mashee_mart_security_audit.md,
-- 🟠): product_units (pack/carton pricing, e.g. كرتون/كيس) never got the
-- admin-vs-cashier RLS split that products/categories got in
-- 00000000000023_admin_only_product_category_writes.sql.
--
-- The vulnerability: product_units has had a single blanket "for all"
-- policy since 00000000000012_multi_tenancy_foundation.sql (originally
-- `using (true) with check (true)` in 00000000000005_product_units.sql,
-- later scoped to store_id only) —
--   create policy "authenticated all product_units" on product_units
--     for all to authenticated
--     using (store_id = current_store_id())
--     with check (store_id = current_store_id());
-- Any authenticated cashier in the store can INSERT/UPDATE/DELETE any
-- product_unit — including its sale_price — directly via the Supabase
-- client, with no admin check at all.
--
-- This is worse than the products/categories case fixed in migration 23:
-- there, at least the cost_price field was hidden from cashiers in the UI
-- even though the underlying RLS gap existed. Here, the UI
-- (components/features/inventory/ProductUnitsManager.tsx) has ZERO role
-- gating of any kind — not even client-side hiding. Its own doc comment
-- says "Lets a manager attach extra sale units", but the component never
-- reads `role`, and its parent (components/features/inventory/
-- ProductForm.tsx) renders it unconditionally for any signed-in user who
-- reaches the form with a non-null product, unlike the adjacent cost_price
-- field on the same form which IS gated with isAdminRole(role). So the RLS
-- policy was the only thing standing between a cashier and a fully working
-- add/edit/delete pack-unit-price UI, and RLS did not stand in the way.
--
-- Confirmed business decision (already agreed with the client, do not
-- re-litigate): SELECT stays open to any same-store authenticated user —
-- cashiers must read unit prices for checkout/barcode scanning
-- (services/products.service.ts#resolveBarcode / listAllProductUnits /
-- listProductUnits). INSERT/UPDATE/DELETE become admin-only.
--
-- Difference from the products/categories precedent (migration 23), and
-- why: there, cashiers keep INSERT (needed for the "quick add product"
-- flow). Here, INSERT is ALSO made admin-only, unlike products/categories.
-- Grepped every caller of createProductUnit/updateProductUnit/
-- deleteProductUnit (services/products.service.ts) across the whole app:
-- createProductUnit and deleteProductUnit each have exactly one caller,
-- both in ProductUnitsManager.tsx (itself only ever rendered from
-- ProductForm.tsx); updateProductUnit has zero callers anywhere today.
-- There is no cashier-facing "quick add a pack unit" flow anywhere in the
-- app (QuickAddProductForm.tsx, the cashier-reachable add-product screen,
-- has no unit-adding UI at all) to preserve, so unlike products/
-- categories, INSERT is locked down here too.
--
-- Reuses the exact inline admin-check pattern already established in
-- 00000000000015_store_contact_info.sql, 00000000000018_cash_drawer_shifts.sql,
-- and 00000000000023_admin_only_product_category_writes.sql —
-- `exists (select 1 from profiles where id = auth.uid() and role = 'admin')`
-- — rather than introducing a new helper function, for consistency.
--
-- RPC impact check: grepped receive_product_stock, adjust_product_stock,
-- create_sale_atomic, and record_return. create_sale_atomic
-- (00000000000027_atomic_sale_recording.sql) only SELECTs product_units to
-- resolve unit pricing server-side; none of the other three reference
-- product_units at all. No RPC writes to this table, so nothing breaks.

drop policy if exists "authenticated all product_units" on product_units;

create policy "authenticated select product_units" on product_units for select to authenticated
  using (store_id = current_store_id());

create policy "admin insert product_units" on product_units for insert to authenticated
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin update product_units" on product_units for update to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin delete product_units" on product_units for delete to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
