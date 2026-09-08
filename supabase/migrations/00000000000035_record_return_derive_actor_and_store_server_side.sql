-- record_return trusted client-supplied p_actor_id/p_store_id instead of
-- deriving them from auth.uid()/current_store_id() — closes an open
-- finding from the ongoing security-audit remediation series (same audit
-- as migrations 00000000000021-00000000000034).
--
-- The finding: record_return (00000000000021_atomic_return_recording.sql)
-- is security definer and includes a manual tenant check —
-- `if v_sale_item.store_id <> p_store_id then raise exception ...` — that
-- migration 21's own header correctly identifies as mandatory (security
-- definer bypasses RLS, so without SOME check any authenticated user could
-- read/insert against another store's sale_item_id). But the check as
-- written only verifies that the CLIENT-SUPPLIED p_store_id is
-- self-consistent with the sale_item's real store — it is a
-- self-consistency check, not an authorization check. It never verifies
-- that the CALLING USER actually belongs to that store. A cashier who
-- knows or guesses a sale_item_id belonging to a different store can call
-- the RPC directly (bypassing the UI) and simply pass that other store's
-- real id as p_store_id, satisfying the check while never having been a
-- member of that store — the exact cross-tenant read+insert migration 21
-- set out to prevent remains possible via this one-parameter substitution.
-- p_actor_id has the same defect one level down: even for an honest
-- same-store call, a cashier can pass any other user's id as p_actor_id
-- and have the return attributed to them in the audit trail
-- (returns.actor_id), since nothing ties the argument to the caller's real
-- session.
--
-- Both parameters are client-supplied for no real reason — the legitimate
-- values (components/features/sales/SaleReturnPanel.tsx, via useAuth())
-- are already exactly auth.uid() and current_store_id() when the RPC is
-- called honestly through the app. They're only reachable as spoofable
-- plain arguments because they were passed explicitly instead of derived
-- inside the function, the same class of mistake migration 27
-- (create_sale_atomic) explicitly called out and avoided when it was
-- written: "derives store_id via current_store_id() and cashier_id via
-- auth.uid() instead of trusting client-supplied values ... deliberately
-- NOT repeating record_return's flagged p_store_id/p_actor_id pattern".
-- This migration finally applies that same fix to record_return itself.
--
-- Fix: drop the two parameters entirely and derive both values inside the
-- function body — current_store_id() (defined in
-- 00000000000013_stores_rls_and_subscription_gate.sql; security definer
-- stable, already the repo-standard helper used throughout RLS policies;
-- fails closed to null if the caller's store is suspended) and auth.uid()
-- (the caller's real, session-bound identity — cannot be forged via RPC
-- arguments). The tenant check becomes
-- `if v_sale_item.store_id <> current_store_id() then raise exception`,
-- which is now a REAL authorization check: it fails for a caller who
-- belongs to no store (null) and for a caller whose real store doesn't
-- match the sale_item's store, with no argument left for a client to
-- substitute their way around. Since p_store_id/p_actor_id no longer exist
-- as parameters at all, spoofing either one is no longer just prevented —
-- it's not expressible in the RPC call in the first place.
--
-- Nothing else about the function changes: the row lock on sale_items
-- (2.3 fix), the quantity guard, the refund-amount cap at
-- round(unit_price * quantity, 2) with no admin override (2.2 fix), the
-- already-returned sum, and the sale_id-matches-sale_item check are all
-- carried over byte-for-byte. This migration only changes the trust
-- boundary for actor/store identity, not the function's core validation
-- logic.
--
-- Postgres does not allow changing a function's parameter list via
-- `create or replace function` — the argument list is part of the
-- function's identity/signature. The old 11-arg overload is dropped
-- explicitly before the new 9-arg one is created.

drop function if exists public.record_return(
  uuid, uuid, uuid, text, integer, text, integer, numeric, text, uuid, uuid
);

create function public.record_return(
  p_sale_id uuid,
  p_sale_item_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_quantity integer,
  p_unit_label text,
  p_unit_conversion_factor integer,
  p_refund_amount numeric,
  p_reason text
)
returns setof returns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_item sale_items%rowtype;
  v_already_returned numeric;
  v_remaining numeric;
  v_max_refund numeric;
begin
  if p_quantity <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  if p_refund_amount < 0 then
    raise exception 'قيمة الاسترجاع يجب أن تكون صفراً أو أكبر';
  end if;

  -- Row-lock the stable parent sale_items row so concurrent record_return
  -- calls for the same sale line serialize instead of both reading the
  -- same "already returned" total and both passing validation (fix for
  -- 2.3 — see 00000000000021_atomic_return_recording.sql header for why
  -- the lock lives here and not on returns).
  select * into v_sale_item from sale_items where id = p_sale_item_id for update;

  if not found then
    raise exception 'سطر البيع غير موجود';
  end if;

  -- Mandatory tenant check — security definer bypasses RLS, so without
  -- this a caller could pass a sale_item_id belonging to a different store
  -- and insert a cross-tenant returns row. current_store_id() is derived
  -- from the caller's own session (auth.uid() -> profiles.store_id), not
  -- from a client-supplied argument, so this is now a real authorization
  -- check rather than the old self-consistency check against a
  -- client-supplied p_store_id.
  if v_sale_item.store_id <> current_store_id() then
    raise exception 'سطر البيع لا يتبع هذا المتجر';
  end if;

  if p_sale_id <> v_sale_item.sale_id then
    raise exception 'سطر البيع لا يتبع هذه الفاتورة';
  end if;

  select coalesce(sum(quantity), 0)
    into v_already_returned
    from returns
    where sale_item_id = p_sale_item_id;

  v_remaining := v_sale_item.quantity - v_already_returned;

  if p_quantity > v_remaining then
    raise exception 'الكمية المطلوب إرجاعها أكبر من المتبقي القابل للإرجاع (المتبقي: %)', v_remaining;
  end if;

  -- Fix for 2.2 — unconditional cap at the original sale price for the
  -- requested quantity, no admin-override path (confirmed business rule).
  v_max_refund := round(v_sale_item.unit_price * p_quantity, 2);

  if p_refund_amount > v_max_refund then
    raise exception 'قيمة الاسترجاع (%) أكبر من الحد المسموح لهذه الكمية (%)', p_refund_amount, v_max_refund;
  end if;

  return query
    insert into returns (
      sale_id,
      sale_item_id,
      product_id,
      product_name,
      quantity,
      unit_label,
      unit_conversion_factor,
      refund_amount,
      reason,
      actor_id,
      store_id
    )
    values (
      p_sale_id,
      p_sale_item_id,
      p_product_id,
      p_product_name,
      p_quantity,
      p_unit_label,
      p_unit_conversion_factor,
      p_refund_amount,
      p_reason,
      auth.uid(),
      current_store_id()
    )
    returning *;
end;
$$;

grant execute on function public.record_return(uuid, uuid, uuid, text, integer, text, integer, numeric, text) to authenticated;
