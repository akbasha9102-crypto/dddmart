-- Bounds on products.cost_price / products.sale_price — fixes audit item
-- 3.2 (medium, mashee_mart_audit_report.md).
--
-- products.cost_price and products.sale_price (00000000000000_init.sql)
-- have never had a CHECK constraint, unlike product_units.sale_price
-- which already got `check (sale_price >= 0)` back in
-- 00000000000005_product_units.sql. The UI only rejected
-- Number(salePrice) <= 0 (ProductForm.tsx, QuickAddProductForm.tsx) and
-- never validated cost_price at all, so a typed/pasted negative value in
-- either field could reach the database untouched.
--
-- Scope, confirmed with the client (do not re-litigate): only a
-- genuinely NEGATIVE cost_price or sale_price is ever invalid — that's
-- purely a data-entry error class, never a legitimate business state.
-- "Selling at or below cost" (sale_price <= cost_price, both
-- non-negative) is a deliberate, legitimate business decision (e.g.
-- clearance pricing, loss leaders) and must remain fully allowed —
-- ProfitPreview.tsx already shows an amber warning for this case but
-- must never block it, and this migration does not touch that
-- relationship at all. Only >= 0 bounds are added below, matching
-- product_units.sale_price's existing constraint.
--
-- Pre-migration data check (live DB, read-only query, run before writing
-- this migration): all 29 existing `products` rows already satisfy
-- cost_price >= 0 and sale_price >= 0 (min observed value for both
-- columns across all rows was exactly 0.00) — zero violating rows found,
-- so no backfill/clamp step is needed before adding the constraints
-- below. As additional confirmation that the "sell at/below cost" case
-- must stay unblocked, 5 of the 29 existing rows already have
-- sale_price <= cost_price in live data today.
--
-- This is the real enforcement layer: CHECK constraints on the products
-- table itself, so the rule holds even if a caller bypasses
-- createProduct/updateProduct (services/products.service.ts) entirely
-- and issues a direct Supabase client insert/update. Deliberately paired
-- with application-level checks in both ProductForm.tsx#handleSubmit and
-- QuickAddProductForm.tsx#handleSubmit (friendlier Arabic error before
-- hitting this raw DB constraint) and UI-level clamps on both price
-- inputs in each form (UX polish only) — same three-layer defense
-- pattern already used for sales.discount_amount in
-- 00000000000024_discount_amount_bounds.sql.
alter table products
  add constraint products_cost_price_bounds
  check (cost_price >= 0);

alter table products
  add constraint products_sale_price_bounds
  check (sale_price >= 0);
