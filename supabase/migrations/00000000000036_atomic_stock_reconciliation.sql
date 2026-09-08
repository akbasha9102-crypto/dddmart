-- Stock reconciliation (services/reconciliations.service.ts#recordReconciliation)
-- has a read-then-write TOCTOU race that can make the final recorded
-- quantity diverge from what was physically counted — closes an open
-- finding from the ongoing security-audit remediation series (same audit
-- as migrations 00000000000021-00000000000035; also documented, with an
-- earlier/less-complete sketch, in mashee_mart_security_audit.md under
-- "سباق تزامن (Race Condition) في تسوية الجرد").
--
-- The race, concretely: the old JS code (1) SELECTs products.quantity into
-- a local `previousQuantity`, (2) computes `difference = countedQuantity -
-- previousQuantity` in application code, then (3) calls
-- `adjust_product_stock(p_delta = difference)`, which atomically applies
-- that FIXED delta to whatever products.quantity happens to be AT UPDATE
-- TIME. adjust_product_stock's own atomicity is fine in isolation (a
-- single `update ... set quantity = quantity + p_delta ... where quantity
-- + p_delta >= 0` is safe under Postgres row locking) — the bug is that
-- the DELTA itself was computed from a stale snapshot taken before the
-- update runs. Worked example: a product shows quantity 14 on screen. An
-- employee opens the reconciliation form and reads previousQuantity = 14.
-- Before they submit, a cashier on another till sells 3 units via a
-- concurrent checkout, taking live quantity to 11. The employee counts 10
-- physical units and submits countedQuantity = 10. The old code computes
-- difference = 10 - 14 = -4 (from the STALE snapshot) and calls
-- adjust_product_stock(p_delta = -4), which applies -4 to the LIVE value
-- 11, landing on 7 — not 10, the number actually counted. The recorded
-- stock_reconciliations row also lies: previous_quantity is stored as the
-- stale 14 (not the true pre-update 11), and difference/loss_value are
-- both derived from that same stale, wrong snapshot. The whole point of a
-- physical reconciliation — forcing system stock to equal a real count —
-- silently fails to hold, without any error surfaced to the user.
--
-- Fix: a new atomic RPC, record_reconciliation, modeled on record_return's
-- just-hardened shape (migration 35) and adjust_product_stock/
-- receive_product_stock's row-lock/tenant-check style (migrations 23/32).
-- It takes the physically COUNTED quantity, not a pre-computed delta, and
-- does everything against one row lock:
--   1. `select * into v_product from products where id = p_product_id for
--      update` — locks the row (same mechanism as record_return's `select
--      ... for update` on sale_items, and close_shift_atomic's lock on
--      shifts). Any concurrent sale/return/other reconciliation touching
--      this same product now serializes behind this lock instead of
--      interleaving with it.
--   2. Manual tenant check against the LOCKED row's real store_id, reusing
--      adjust_product_stock/receive_product_stock's exact phrase
--      ('المنتج لا يتبع هذا المتجر') for consistency.
--   3. difference is computed from v_product.quantity — the value read
--      UNDER THE LOCK, moments ago, not a value the client read earlier
--      and shipped back. This is the actual fix: the "previous quantity"
--      used for the difference/audit-row and the update that follows it
--      are now based on the exact same atomically-locked read, so nothing
--      can change products.quantity in between.
--   4. `update products set quantity = p_counted_quantity ...` — a direct
--      SET to the counted value, not delta arithmetic. This is safe (and
--      correct — a physical count is the ground truth, not an increment)
--      specifically because the row lock acquired in step 1 is held for
--      the entire duration of this function (release only happens at
--      function/transaction end), so no concurrent writer can slip in
--      between the lock and this update.
--   5. loss_value/insert into stock_reconciliations use the same locked
--      v_product values (quantity, cost_price, unit) throughout — no
--      second read, no re-derivation from anything client-supplied.
--
-- Unlike record_return (which needed migration 35 as a FOLLOW-UP fix to
-- stop trusting client-supplied p_actor_id/p_store_id), this function
-- derives actor_id (auth.uid()) and store_id (current_store_id()) from the
-- start — there is no p_actor_id/p_store_id/p_previous_quantity/
-- p_cost_price/p_unit parameter at all. Every value that must be
-- authoritative (who did this, which store, what the stock really was)
-- comes from the server side (session or locked row), never from a plain
-- RPC argument a caller could substitute. This also means the function
-- signature is intentionally narrower than the sketch in
-- mashee_mart_security_audit.md's own illustrative snippet (which still
-- passed p_store_id as a plain argument with a self-consistency
-- `where store_id = p_store_id` filter) — that sketch was illustrative
-- only; the shipped fix here goes further, matching migration 35's
-- already-established real-authorization-check pattern instead.
--
-- security definer is required for the same reason it's required by
-- adjust_product_stock (migration 23) and receive_product_stock
-- (migration 32): the `admin update products` RLS policy
-- (00000000000023_admin_only_product_category_writes.sql) restricts
-- direct UPDATEs on products to admins only. A cashier calling this
-- function must still be able to correct stock via a physical count
-- (ReconciliationForm is cashier-reachable, same as the scan/checkout/
-- receive-stock flows), so this function bypasses RLS via security
-- definer and replaces it with its own manual tenant check (step 2 above)
-- — the same substitution already applied to adjust_product_stock/
-- receive_product_stock. stock_reconciliations' own INSERT policy
-- ('authenticated insert stock_reconciliations', open to any same-store
-- authenticated user) is likewise bypassed by security definer, but this
-- is not a weakening: the function's own tenant check enforces the same
-- boundary the RLS policy would have, and the row is always inserted with
-- store_id = current_store_id(), never a client-supplied value.
create function public.record_reconciliation(
  p_product_id uuid,
  p_product_name text,
  p_counted_quantity integer,
  p_reason text
)
returns setof stock_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product products%rowtype;
  v_difference integer;
  v_loss_value numeric;
begin
  -- Row-lock the product so any concurrent sale/return/receive-stock/
  -- other-reconciliation call against the same row serializes behind
  -- this one instead of both reading the same stale quantity.
  select * into v_product from products where id = p_product_id for update;

  if not found then
    raise exception 'تعذر العثور على المنتج';
  end if;

  -- Mandatory tenant check — security definer bypasses RLS, so without
  -- this a caller could pass a product_id belonging to a different store.
  -- Same phrase used by adjust_product_stock/receive_product_stock for
  -- consistency.
  if v_product.store_id <> current_store_id() then
    raise exception 'المنتج لا يتبع هذا المتجر';
  end if;

  -- Computed from v_product.quantity, which was read UNDER THE LOCK just
  -- now — not a value the client read earlier and sent back. This is the
  -- actual TOCTOU fix.
  v_difference := p_counted_quantity - v_product.quantity;

  if v_difference = 0 then
    raise exception 'لا يوجد فرق لتسجيله';
  end if;

  -- Direct SET to the counted value (not delta arithmetic) — safe here
  -- specifically because the row lock from the SELECT above is held
  -- through to this UPDATE, so no concurrent writer can interleave.
  update products
  set quantity = p_counted_quantity,
      updated_at = now()
  where id = p_product_id;

  -- loss_value is only ever populated for a shortage; an overage corrects
  -- the quantity but is never valued as profit (unchanged business rule).
  v_loss_value := case when v_difference < 0 then abs(v_difference) * v_product.cost_price else 0 end;

  return query
    insert into stock_reconciliations (
      product_id,
      product_name,
      unit,
      previous_quantity,
      counted_quantity,
      difference,
      cost_price,
      loss_value,
      reason,
      actor_id,
      store_id
    )
    values (
      p_product_id,
      p_product_name,
      v_product.unit,
      v_product.quantity,
      p_counted_quantity,
      v_difference,
      v_product.cost_price,
      v_loss_value,
      p_reason,
      auth.uid(),
      current_store_id()
    )
    returning *;
end;
$$;

grant execute on function public.record_reconciliation(uuid, text, integer, text) to authenticated;
