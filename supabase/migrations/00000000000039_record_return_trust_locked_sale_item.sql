-- record_return trusted client-supplied p_product_id/p_product_name/
-- p_unit_label/p_unit_conversion_factor for what gets written into the
-- returns row, instead of deriving them from the row-locked sale_items
-- record it had already validated quantity/refund against — closes an
-- open finding from the ongoing security-audit remediation series (same
-- audit as migrations 00000000000021-00000000000035, 00000000000037).
--
-- The finding: record_return locks and validates against the real
-- sale_items row (quantity remaining, refund cap), but then INSERTs
-- p_product_id/p_product_name/p_unit_label/p_unit_conversion_factor
-- exactly as sent by the caller, never comparing them to
-- v_sale_item.product_id/product_name/unit_label/unit_conversion_factor.
-- services/returns.service.ts#recordReturn then calls incrementStock
-- using the CLIENT-SUPPLIED productId/unitConversionFactor (not anything
-- from the RPC's response). A caller invoking
-- supabase.rpc('record_return', {...}) directly (bypassing the UI and
-- sale_items_secure) can return a real, small, legitimately-owned sale
-- line -- quantity/refund caps pass because they're checked against the
-- real locked row -- while passing a forged p_unit_conversion_factor
-- (e.g. 2400 instead of the real 24) and/or a forged p_product_id
-- (pointing at a completely different, more valuable product). Neither
-- forged value is checked anywhere, so the resulting returns row lies
-- about what was returned, and the caller's own subsequent
-- incrementStock call credits wildly inflated stock, or stock to the
-- wrong product entirely -- free/fabricated inventory, repeatable at
-- will.
--
-- Fix: same trust-boundary pattern already applied to this function's
-- actor_id/store_id in 00000000000035_record_return_derive_actor_and_
-- store_server_side.sql -- always derive server-side from the row already
-- locked and validated, never trust the client-supplied echo of the same
-- data, rather than validate-and-reject. The four parameters
-- (p_product_id, p_product_name, p_unit_label,
-- p_unit_conversion_factor) are kept in the function signature
-- unchanged (nothing else in the codebase needs to change its call site
-- shape), but are now fully ignored for what gets written to `returns`:
-- the INSERT uses v_sale_item.product_id, v_sale_item.product_name,
-- v_sale_item.unit_label, v_sale_item.unit_conversion_factor instead.
-- Substitution (not validation-and-rejection) is chosen because an
-- honest client's values are already guaranteed to equal these same
-- sale_items columns in every real call path (the UI only ever reads
-- them from sale_items_secure in the first place), so a mismatch check
-- would never legitimately fire for a real user and would still require
-- computing the authoritative values to compare against -- substitution
-- gets the same guarantee with less code and one clear source of truth.
--
-- services/returns.service.ts#recordReturn is updated in the same
-- change to read product_id/quantity/unit_conversion_factor back off
-- this function's own returned row for its incrementStock call, instead
-- of off the client-supplied params -- otherwise the RPC fix alone would
-- not close the stock-inflation exploit, since incrementStock never
-- re-reads the inserted row today.
--
-- Nothing else about the function changes: the row lock on sale_items
-- (2.3 fix), the tenant check derived from current_store_id() (migration
-- 35 fix), the quantity guard, the refund-amount cap at round(unit_price
-- * quantity, 2) with no admin override (2.2 fix), the already-returned
-- sum, the sale_id-matches-sale_item check, and the customer-debt
-- reduction (migration 37 fix) are all carried over byte-for-byte.
--
-- Signature is unchanged from migration 35/37, so `create or replace
-- function` applies cleanly (no drop/create needed) and the grant is
-- re-declared below per this repo's existing convention (see migrations
-- 35 and 37, both of which re-issue the identical grant after
-- create-or-replace even though it was already granted before).

create or replace function public.record_return(
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
  v_customer_id uuid;
  v_inserted_return returns%rowtype;
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
  -- 2.3 -- see 00000000000021_atomic_return_recording.sql header for why
  -- the lock lives here and not on returns). This locked row is also now
  -- the sole source of truth for product_id/product_name/unit_label/
  -- unit_conversion_factor written below -- see this migration's header.
  select * into v_sale_item from sale_items where id = p_sale_item_id for update;

  if not found then
    raise exception 'سطر البيع غير موجود';
  end if;

  -- Mandatory tenant check -- security definer bypasses RLS, so without
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

  -- Fix for 2.2 -- unconditional cap at the original sale price for the
  -- requested quantity, no admin-override path (confirmed business rule).
  v_max_refund := round(v_sale_item.unit_price * p_quantity, 2);

  if p_refund_amount > v_max_refund then
    raise exception 'قيمة الاسترجاع (%) أكبر من الحد المسموح لهذه الكمية (%)', p_refund_amount, v_max_refund;
  end if;

  -- Fix (this migration): product_id/product_name/unit_label/
  -- unit_conversion_factor are taken from the row-locked, already-
  -- validated v_sale_item -- NOT from p_product_id/p_product_name/
  -- p_unit_label/p_unit_conversion_factor -- so a caller cannot forge an
  -- inflated unit_conversion_factor or point the return at a different
  -- product while still passing validation against their own real,
  -- small sale_items row.
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
    v_sale_item.product_id,
    v_sale_item.product_name,
    p_quantity,
    v_sale_item.unit_label,
    v_sale_item.unit_conversion_factor,
    p_refund_amount,
    p_reason,
    auth.uid(),
    current_store_id()
  )
  returning * into v_inserted_return;

  -- Debt-reduction fix (audit item #3): only when the original sale was a
  -- credit sale. A cash sale has customer_id = null, so this block is
  -- skipped entirely -- cash returns remain a complete no-op against
  -- customer_transactions. Guarded on p_refund_amount > 0 because
  -- customer_transactions.amount has check (amount > 0) -- record_return
  -- allows p_refund_amount = 0 (e.g. a defective-item return with no cash
  -- owed back), and inserting a zero-amount row would violate that check
  -- and roll back the whole function, including the returns row just
  -- inserted above.
  select customer_id into v_customer_id from sales where id = p_sale_id;

  if v_customer_id is not null and p_refund_amount > 0 then
    insert into customer_transactions (customer_id, type, amount, sale_id, store_id, cashier_id)
    values (v_customer_id, 'return', p_refund_amount, p_sale_id, current_store_id(), auth.uid());
  end if;

  return next v_inserted_return;
end;
$$;

grant execute on function public.record_return(uuid, uuid, uuid, text, integer, text, integer, numeric, text) to authenticated;
