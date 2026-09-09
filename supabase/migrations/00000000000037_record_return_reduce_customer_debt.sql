-- Reduces a customer's debt balance when a product from a credit sale
-- (بيع آجل) is returned — fixes audit item #3 (mashee_mart_general_audit.md).
--
-- The bug: record_return records the return and restores stock, but never
-- touches customer_transactions. Since customer_balances is computed as
-- sum(sale) - sum(everything else), a customer who returns goods bought on
-- credit remains billed for the full original sale amount forever.
--
-- Fix: when the sale being returned from has an associated customer (i.e.
-- was a credit sale — sales.customer_id is only ever non-null for
-- payment_method = 'credit', see create_sale_atomic), insert one
-- customer_transactions row that reduces the balance by exactly
-- p_refund_amount. A cash sale has customer_id = null, so this is a strict
-- no-op for every cash return.
--
-- New transaction type 'return', NOT a reuse of 'payment':
--   * customer_balances nets any type != 'sale' as a debit, so 'return'
--     needs zero view changes.
--   * close_shift_atomic computes a cashier's expected CASH-drawer total
--     using sum(customer_transactions.amount) where type = 'payment' —
--     that represents real physical cash received. A credit-sale return is
--     NOT cash changing hands. Using type='payment' here would make
--     close_shift_atomic silently subtract a non-cash amount from expected
--     cash, manufacturing a phantom shortage. type='return' is invisible
--     to that filter, so close_shift_atomic is completely unaffected.
--   * Cash-sale refunds are already handled entirely separately by
--     close_shift_atomic's own v_cash_refunds (sums returns.refund_amount
--     directly) — this migration never touches that path since it only
--     inserts a customer_transactions row when sales.customer_id is not
--     null.

alter table customer_transactions drop constraint if exists customer_transactions_type_check;
alter table customer_transactions add constraint customer_transactions_type_check
  check (type in ('sale', 'payment', 'return'));

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
  returning * into v_inserted_return;

  -- Debt-reduction fix (audit item #3): only when the original sale was a
  -- credit sale. A cash sale has customer_id = null, so this block is
  -- skipped entirely — cash returns remain a complete no-op against
  -- customer_transactions. Guarded on p_refund_amount > 0 because
  -- customer_transactions.amount has check (amount > 0) — record_return
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
