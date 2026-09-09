-- stock_damages is directly insertable by any authenticated same-store user
-- with NO connection to an actual products.quantity decrement -- closes an
-- open finding from the ongoing security-audit remediation series (same
-- audit as migrations 00000000000021-00000000000039; documented as finding
-- #2 in ddd_mart_security_audit.md, "تزوير سجلات stock_damages (فاقد/تلف)
-- بدون ربط فعلي بخصم المخزون").
--
-- The finding: services/damages.service.ts#recordDamage performs TWO
-- separate, non-atomic operations -- (1) calls adjust_product_stock (RPC) to
-- actually decrement products.quantity, then (2) does a plain
-- `.from("stock_damages").insert(...)` with cost_price/loss_amount computed
-- from step 1's result. Nothing in the database links these two steps.
-- stock_damages' current INSERT policy (final form, from migration 12) only
-- checks `store_id = current_store_id()`:
--
--   create policy "authenticated insert stock_damages" on stock_damages
--     for insert to authenticated with check (store_id = current_store_id());
--
-- A cashier with a valid session can skip recordDamage entirely and POST
-- directly to the stock_damages REST endpoint with a real product_id from
-- their own store (passes the only RLS check) but ANY quantity/cost_price/
-- loss_amount/actor_id they want -- with zero actual stock decrement ever
-- happening, since the RLS check never touches products. This allows
-- fabricating loss records to explain away stock that was actually stolen
-- or sold off-book, skewing profit/loss reports with a fabricated
-- loss_amount unrelated to the product's real cost, and framing a coworker
-- via a forged actor_id.
--
-- The sibling ledger table `returns` had this exact bug class and was fixed
-- by moving all writes behind a security definer RPC (record_return) that
-- derives identity/store fields server-side and validates against a
-- row-locked source-of-truth row -- see migrations 21, 35, 37, 39.
-- stock_damages never received the equivalent treatment until now.
--
-- Fix: a new atomic RPC, record_damage, modeled directly on
-- record_reconciliation's shape (migration 36) -- the closest existing
-- sibling, since it also needs a row-locked read of a product's live
-- quantity/cost_price to both validate against and write from in the same
-- instant:
--   1. `select * into v_product from products where id = p_product_id for
--      update` -- locks the row so a concurrent sale/return/reconciliation/
--      other damage record against the same product serializes behind this
--      one instead of reading a stale quantity/cost_price.
--   2. Mandatory tenant check against the LOCKED row's real store_id
--      (security definer bypasses RLS) -- same phrase used by
--      adjust_product_stock/receive_product_stock/record_reconciliation for
--      consistency: 'المنتج لا يتبع هذا المتجر'.
--   3. p_quantity > 0 validation, then an insufficient-stock check against
--      v_product.quantity (the value read UNDER THE LOCK moments ago, not a
--      value the client read earlier and shipped back), raising
--      'الكمية أكبر من المخزون المتوفر (المتوفر: %)' with the real
--      available quantity interpolated -- this RPC is single-purpose, so it
--      raises this exception directly rather than reusing
--      adjust_product_stock's generic "empty result means insufficient
--      stock" contract (that contract exists because adjust_product_stock
--      is a shared low-level primitive reused by many callers with
--      different error-handling needs; record_damage is not). This mirrors
--      record_reconciliation's and record_return's own direct-exception
--      style for single-purpose RPCs.
--   4. cost_price/loss_amount are NEVER accepted as parameters -- there is
--      no p_cost_price or p_loss_amount argument at all. Both are computed
--      entirely from v_product.cost_price, the value read under the same
--      lock, so a caller cannot forge a loss_amount unrelated to the
--      product's actual cost basis.
--   5. actor_id = auth.uid() and store_id = current_store_id() are always
--      server-derived, never client parameters -- consistent with
--      record_return's migration-35 fix and record_reconciliation's
--      from-the-start design.
--   6. p_product_name is kept as a client-supplied, display-only parameter
--      (matching record_reconciliation's p_product_name) -- it is never
--      used in the cost/loss computation, only stored as-is for display,
--      same tolerance for snapshot staleness already accepted for
--      stock_reconciliations/stock_purchases/returns product_name columns.
--
-- security definer is required for the same reason as
-- adjust_product_stock/receive_product_stock/record_reconciliation: the
-- `admin update products` RLS policy
-- (00000000000023_admin_only_product_category_writes.sql) restricts direct
-- UPDATEs on products to admins only, but any same-store cashier must still
-- be able to record damage (DamageStockForm is cashier-reachable). This
-- function bypasses RLS via security definer and replaces it with its own
-- manual tenant check (step 2 above) -- the same substitution already
-- applied to every other atomic stock-mutating RPC in this codebase.
--
-- After this function exists, the direct INSERT policy on stock_damages is
-- dropped so the RPC becomes the sole write path -- mirroring how
-- sales/sale_items/shifts/stock_reconciliations all had their direct
-- INSERT/UPDATE policies dropped once their atomic RPCs existed. The SELECT
-- policy is untouched: reading damage records is still fine for any
-- same-store authenticated user, unchanged from today.
create function public.record_damage(
  p_product_id uuid,
  p_product_name text,
  p_quantity integer,
  p_reason text
)
returns setof stock_damages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product products%rowtype;
  v_loss_amount numeric;
begin
  if p_quantity <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  -- Row-lock the product so any concurrent sale/return/receive-stock/
  -- reconciliation/other-damage call against the same row serializes behind
  -- this one instead of both reading the same stale quantity/cost_price.
  select * into v_product from products where id = p_product_id for update;

  if not found then
    raise exception 'تعذر العثور على المنتج';
  end if;

  -- Mandatory tenant check — security definer bypasses RLS, so without this
  -- a caller could pass a product_id belonging to a different store. Same
  -- phrase used by adjust_product_stock/receive_product_stock/
  -- record_reconciliation for consistency.
  if v_product.store_id <> current_store_id() then
    raise exception 'المنتج لا يتبع هذا المتجر';
  end if;

  -- Checked against v_product.quantity, which was read UNDER THE LOCK just
  -- now — not a value the client read earlier and sent back.
  if p_quantity > v_product.quantity then
    raise exception 'الكمية أكبر من المخزون المتوفر (المتوفر: %)', v_product.quantity;
  end if;

  update products
  set quantity = quantity - p_quantity,
      updated_at = now()
  where id = p_product_id;

  -- loss_amount is computed entirely from the locked row's real cost_price
  -- — there is no p_cost_price/p_loss_amount parameter, so a caller cannot
  -- forge a loss figure unrelated to the product's actual cost basis.
  v_loss_amount := p_quantity * v_product.cost_price;

  return query
    insert into stock_damages (
      product_id,
      product_name,
      quantity,
      cost_price,
      loss_amount,
      reason,
      actor_id,
      store_id
    )
    values (
      p_product_id,
      p_product_name,
      p_quantity,
      v_product.cost_price,
      v_loss_amount,
      p_reason,
      auth.uid(),
      current_store_id()
    )
    returning *;
end;
$$;

grant execute on function public.record_damage(uuid, text, integer, text) to authenticated;

-- record_damage is now the sole write path for stock_damages — direct
-- client INSERTs are closed off, mirroring sales/sale_items/shifts/
-- stock_reconciliations after their own atomic RPCs shipped. SELECT is
-- untouched (still open to any same-store authenticated user).
drop policy if exists "authenticated insert stock_damages" on stock_damages;
