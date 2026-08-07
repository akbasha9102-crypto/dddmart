-- Historical snapshot of a sale line's cost price at the moment it was
-- added to the cart. Plain column, not a FK to products.cost_price — same
-- pattern as unit_label/unit_conversion_factor in this table (see
-- 00000000000005_product_units.sql): editing a product's cost later must
-- never change a past invoice's recorded profit.
-- DEFAULT 0 means every pre-existing row reads as "unknown historical
-- cost" (profit = full sale price) — expected/acceptable, not a data
-- error; see docs/superpowers/specs/2026-08-07-accurate-profit-tracking-design.md.
alter table sale_items
  add column if not exists cost_price numeric(12, 2) not null default 0;
