-- receive_product_stock: convert to security definer + manual tenant check.
--
-- Without this change, this function silently breaks cashier stock-receiving
-- (services/products.service.ts#receiveStock, called from #recordStockPurchase
-- via the "استلام بضاعة" flow) for every cashier, the moment the products
-- UPDATE policy became admin-only in
-- 00000000000023_admin_only_product_category_writes.sql. This function is
-- currently `security invoker` and relies entirely on the caller's own RLS
-- to make its `update products set quantity = ... where id = ...` match a
-- row. Under the admin-only UPDATE policy, a cashier's session can no longer
-- update the products row at all, so the UPDATE matches zero rows — and this
-- function's own documented contract is "zero rows returned means failure"
-- (services/products.service.ts#receiveStock returns null on an empty
-- array; #recordStockPurchase then throws "تعذر استلام المخزون — تحقق من
-- القيم المدخلة"). Every legitimate cashier "receive purchased stock" call
-- fails today with a misleading validation-style error, even though the
-- input is perfectly valid — this is a real functional regression, not a
-- security tightening (receive_product_stock is intentionally cashier-facing
-- and stays that way; see grant at the bottom, unchanged).
--
-- Fix mirrors the precedent set by adjust_product_stock in the same
-- migration 00000000000023 (00000000000023_admin_only_product_category_writes.sql)
-- and by record_return in 00000000000021_atomic_return_recording.sql:
-- security definer (bypasses RLS) plus an explicit manual store_id check
-- that replaces what RLS was providing, so a cross-tenant call is still
-- rejected even though RLS itself no longer runs inside this function.
--
-- The empty-result-means-not-found/guard-failed contract is preserved
-- exactly: the WHERE clause guards (p_added_base_units > 0, p_unit_base_cost
-- >= 0) are byte-for-byte unchanged, and a nonexistent p_product_id still
-- returns zero rows with no exception (checked via `if not found then
-- return; end if;` before ever reaching the update, same as
-- adjust_product_stock). The weighted-average cost_price formula is also
-- byte-for-byte unchanged. The only behavior added is that a cross-tenant
-- p_product_id (a product belonging to a different store than the caller's)
-- now raises an exception instead of silently matching zero rows under RLS
-- — strictly more informative than before, and not a real-world case any
-- legitimate caller triggers today (every caller resolves p_product_id from
-- its own RLS-scoped SELECT first).
create or replace function public.receive_product_stock(
  p_product_id uuid,
  p_added_base_units integer,
  p_unit_base_cost numeric
)
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
end;
$$;

grant execute on function public.receive_product_stock(uuid, integer, numeric) to authenticated;
