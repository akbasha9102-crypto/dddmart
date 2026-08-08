-- Atomically receives purchased stock for a product: increments
-- products.quantity by the base-unit quantity purchased, and recomputes
-- products.cost_price as the weighted average of existing stock cost and
-- the newly purchased stock's cost — in a single UPDATE so a concurrent
-- sale/scan decrementing quantity via adjust_product_stock cannot race
-- with this and produce a wrong weighted average (same atomicity pattern
-- as adjust_product_stock in 00000000000003_atomic_stock_adjust.sql).
--
-- p_added_base_units: quantity purchased, already converted to base units
--   (purchased_quantity * conversion_factor) by the caller.
-- p_unit_base_cost: cost price paid, expressed per base unit (cost paid
--   per purchased unit / conversion_factor) — already converted by caller.
--
-- Guards: p_added_base_units must be > 0 (this RPC only ever increases
-- stock — use adjust_product_stock/inventory.service.ts#adjustStock for
-- corrections/decrements). p_unit_base_cost must be >= 0.
create or replace function public.receive_product_stock(
  p_product_id uuid,
  p_added_base_units integer,
  p_unit_base_cost numeric
)
returns setof products
language sql
security invoker
as $$
  update products
  set quantity = quantity + p_added_base_units,
      cost_price = round(
        (quantity * cost_price + p_added_base_units * p_unit_base_cost)
        / (quantity + p_added_base_units),
        2
      ),
      updated_at = now()
  where id = p_product_id
    and p_added_base_units > 0
    and p_unit_base_cost >= 0
  returning *;
$$;

grant execute on function public.receive_product_stock(uuid, integer, numeric) to authenticated;
