-- Atomic, tenant-safe return recording — fixes audit items 2.2 and 2.3
-- (mashee_mart_audit_report.md).
--
-- 2.2: the old recordReturn (services/returns.service.ts) never validated
-- refund_amount against the original sale line's unit_price * quantity —
-- a cashier could enter an inflated refund amount and pocket the cash
-- difference. This function now caps refund_amount unconditionally at
-- round(sale_items.unit_price * p_quantity, 2), with NO admin-override
-- path — confirmed business rule: refunds are always capped at the
-- original sale price, full stop.
--
-- 2.3: the old recordReturn read the already-returned quantity (sum over
-- `returns` rows) and then inserted the new return as a separate
-- statement, with no atomicity between the two — two rapid clicks/tabs
-- could both read the same "already returned" total, both pass
-- validation, and double-count a return. Fixing this by putting the
-- read-check-insert sequence inside one plpgsql function body isn't
-- enough by itself (statements inside a function still see the same
-- MVCC snapshot issues under the default read-committed isolation
-- unless something takes a lock) — the actual fix is `select ... for
-- update` below, row-locking sale_items so concurrent calls for the same
-- sale line serialize instead of interleaving.
--
-- The lock is taken on sale_items, not returns: sale_items has exactly
-- one stable row per sale line, so locking it gives concurrent callers a
-- single, well-defined row to serialize on. returns has no equivalent —
-- it's an append-only table with many rows per line and no natural
-- "parent" row of its own to lock (locking a row that doesn't exist yet
-- is not possible, and locking all prior return rows for the line is
-- neither simpler nor actually safer than locking the one parent row
-- that already represents "this sale line").
--
-- This function is `security definer` (it needs to bypass RLS to
-- perform the insert on behalf of the caller), which is a deliberate
-- deviation from this repo's existing adjust_product_stock/
-- receive_product_stock RPCs (00000000000003_atomic_stock_adjust.sql,
-- 00000000000008_receive_product_stock.sql) — both of those are
-- `security invoker` with no manual tenant check, which is safe *only*
-- because they exclusively UPDATE a single row (products) that the
-- caller already resolved through their own RLS-scoped SELECT before
-- calling the RPC; they never insert new rows and never touch a second
-- table. record_return is different: it both reads a row it did NOT
-- necessarily resolve through RLS (p_sale_item_id/p_sale_id/p_product_id
-- are plain uuid arguments, not RLS-checked) and inserts a brand-new
-- row. Under security definer, RLS is bypassed entirely, so without a
-- manual check any authenticated user from any store could pass another
-- store's sale_item_id and both read it and insert a cross-tenant
-- returns row. The explicit `v_sale_item.store_id = p_store_id` check
-- below is what closes that hole — do not omit it.
create or replace function public.record_return(
  p_sale_id uuid,
  p_sale_item_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_quantity integer,
  p_unit_label text,
  p_unit_conversion_factor integer,
  p_refund_amount numeric,
  p_reason text,
  p_actor_id uuid,
  p_store_id uuid
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
  -- 2.3 — see file header for why the lock lives here and not on returns).
  select * into v_sale_item from sale_items where id = p_sale_item_id for update;

  if not found then
    raise exception 'سطر البيع غير موجود';
  end if;

  -- Mandatory manual tenant check — see file header: security definer
  -- bypasses RLS, so without this check a caller could pass a
  -- sale_item_id belonging to a different store and insert a
  -- cross-tenant returns row.
  if v_sale_item.store_id <> p_store_id then
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
      p_actor_id,
      p_store_id
    )
    returning *;
end;
$$;

grant execute on function public.record_return(uuid, uuid, uuid, text, integer, text, integer, numeric, text, uuid, uuid) to authenticated;
