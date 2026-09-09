-- Moves the authoritative stock check-and-decrement from add-to-cart time to
-- checkout time, closing a silent-permanent-stock-loss bug confirmed by a
-- multi-agent E2E test (multi_agent_e2e_test_report.md, "خطأ مؤكد #1").
--
-- The bug: hooks/usePOS.ts#addProductToCart called decrementStock (an
-- adjust_product_stock RPC call) the INSTANT an item was added to the cart —
-- long before the sale was actually committed. If the cashier's browser tab/
-- session died before checkout (crash, reload, walked away, phone rang),
-- that decrement was permanent with zero trace anywhere: no sale row, no
-- held_sales row, nothing in stock_damages/returns/reconciliations — the
-- stock simply vanished from products.quantity with no audit trail and no
-- recovery path. The E2E report reproduced this directly: add item to cart,
-- kill the session before paying, product.quantity stays decremented
-- forever.
--
-- The fix (approved direction, client-confirmed): stock is no longer touched
-- at add-to-cart time at all — the cart becomes a purely local, advisory,
-- UNRESERVED list (see hooks/usePOS.ts#addProductToCart, rewritten
-- alongside this migration to a synchronous function with no RPC/IndexedDB
-- call). The authoritative check-and-decrement moves into THIS function,
-- create_sale_atomic (originally created in migration 27,
-- 00000000000027_atomic_sale_recording.sql) — the one RPC that actually
-- commits a sale — mirroring how that RPC already re-derives unit_price/
-- cost_price server-side per line instead of trusting the client's cart
-- snapshot. The sibling function hold_sale gets the identical treatment in
-- migration 43 (00000000000043_hold_sale_stock_decrement.sql), since a held
-- sale is also a real commitment that must genuinely reserve stock.
--
-- What changes inside the existing per-line loop, concretely:
--   1. The existing `select * into v_product from products where id =
--      (v_line->>'product_id')::uuid;` gains `for update` — a row lock held
--      for the rest of this transaction, so two concurrent checkouts against
--      the same product serialize instead of both reading the same
--      pre-decrement quantity and both believing they have enough stock.
--   2. Immediately after unit resolution (which already computes
--      v_conversion_factor — 1 for a base-unit line, or v_unit.
--      conversion_factor when p_unit_name was given) and the existing tenant
--      check, a bounds check + decrement is inserted:
--        - if the requested quantity (converted to base units via
--          v_quantity * v_conversion_factor — same formula
--          lib/units.ts#toBaseUnits uses client-side) exceeds
--          v_product.quantity (read under the lock from step 1, not a value
--          the client's cart snapshot carried), raise a clean Arabic
--          exception naming the product.
--        - otherwise, products.quantity is decremented by that same amount.
--
-- Atomicity guarantee: no explicit transaction-control statements are added
-- (no BEGIN/COMMIT/SAVEPOINT) because none are needed — the entire function
-- body already runs as one implicit Postgres transaction (plpgsql function
-- call), exactly as it did before this migration for the price-resolution
-- and sales/sale_items insert logic. If ANY line in the loop raises the
-- insufficient-stock exception (or any other exception), Postgres rolls back
-- the ENTIRE function invocation — including the products.quantity
-- decrements already applied to EARLIER lines in the same call and the
-- later sales/sale_items/customer_transactions inserts that never get
-- reached. A checkout can never partially decrement stock for some lines
-- and not others, and can never decrement stock without the matching sale
-- row landing (or vice versa).
--
-- Why not call adjust_product_stock (migration 3) instead of inlining the
-- lock+check+decrement here: this codebase's established convention, first
-- set by record_damage (migration 40, 00000000000040_record_damage_atomic.
-- sql) and followed by record_reconciliation before it, is that each
-- single-purpose atomic RPC inlines its own row-locked check-and-decrement
-- logic directly rather than nesting a call to the generic adjust_product_
-- stock primitive. adjust_product_stock's contract (empty result = "some
-- caller-defined failure", the caller infers why) exists specifically for
-- callers that reuse it across several different call sites with different
-- error-handling needs (services/products.service.ts#decrementStock/
-- incrementStock). create_sale_atomic is not such a caller — it already
-- raises its own direct, per-line, Arabic exceptions for every other
-- validation in this same loop (missing product, wrong store, missing
-- unit), so raising its own insufficient-stock exception here, with the
-- product name interpolated, is consistent with the rest of the function
-- and avoids a second RPC call (and a second, redundant row lock/unlock)
-- per line inside a loop that already holds the row locked from step 1.
--
-- adjust_product_stock itself is NOT deprecated by this migration — it
-- remains the mechanism behind services/products.service.ts#incrementStock,
-- which after this change is used SOLELY to release/restore stock (cancel a
-- held sale, or resume-then-release a held sale before its later checkout
-- re-decrements — see services/heldSales.service.ts), never to reserve it.
-- decrementStock (the other half of that pair) is deleted entirely in this
-- same change set — after this migration and migration 43, nothing in the
-- app calls it: the only two places that ever decremented stock
-- (add-to-cart, and the offline sync-replay pre-flight in
-- lib/offline/syncManager.ts) are both removed, since checkout/hold now do
-- the decrement themselves, atomically, inside the RPC call they already
-- make.
create or replace function public.create_sale_atomic(
  p_items jsonb,
  p_discount_amount numeric,
  p_payment_method text,
  p_customer_id uuid,
  p_paid_amount numeric,
  p_client_sale_id uuid default null,
  p_client_invoice_number text default null
)
returns setof sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_cashier_id uuid;
  v_line jsonb;
  v_product products%rowtype;
  v_unit product_units%rowtype;
  v_unit_price numeric(12,2);
  v_cost_price numeric(12,2);
  v_unit_label text;
  v_conversion_factor integer;
  v_quantity numeric;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_total_amount numeric(12,2);
  v_paid_amount numeric(12,2);
  v_change_amount numeric(12,2);
  v_sale sales%rowtype;
begin
  v_store_id := current_store_id();
  if v_store_id is null then
    raise exception 'المتجر غير نشط أو الجلسة غير صالحة';
  end if;

  v_cashier_id := auth.uid();

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'لا يمكن إتمام عملية بيع فارغة';
  end if;

  if p_payment_method not in ('cash', 'credit') then
    raise exception 'طريقة دفع غير صالحة';
  end if;

  if p_payment_method = 'credit' and p_customer_id is null then
    raise exception 'يجب اختيار زبون لإتمام بيع بالآجل';
  end if;

  -- Manual tenant check on the customer, same reasoning as the per-line
  -- product check below: this function is security definer, so RLS on
  -- `customers`/`customer_transactions` never runs for this call, and
  -- p_customer_id is a caller-supplied uuid, not something the caller
  -- necessarily resolved through their own RLS-scoped SELECT. Without this,
  -- a cashier could pass another store's customer_id and record a credit
  -- sale (and debt) against a customer they don't manage.
  if p_payment_method = 'credit' then
    if not exists (select 1 from customers where id = p_customer_id and store_id = v_store_id) then
      raise exception 'الزبون لا يتبع هذا المتجر';
    end if;
  end if;

  if p_discount_amount < 0 then
    raise exception 'قيمة الخصم يجب أن تكون صفراً أو أكبر';
  end if;

  create temporary table _resolved_lines (
    product_id uuid,
    product_name text,
    barcode text,
    quantity numeric,
    unit_price numeric(12,2),
    cost_price numeric(12,2),
    unit_label text,
    unit_conversion_factor integer,
    total_price numeric(12,2)
  ) on commit drop;

  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_line->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'الكمية يجب أن تكون أكبر من صفر';
    end if;

    -- Row-locked for the rest of this transaction — a concurrent checkout
    -- against the same product serializes behind this one instead of both
    -- reading the same pre-decrement quantity (see migration header).
    select * into v_product from products where id = (v_line->>'product_id')::uuid for update;
    if not found then
      raise exception 'المنتج غير موجود';
    end if;
    if v_product.store_id <> v_store_id then
      raise exception 'المنتج لا يتبع هذا المتجر';
    end if;

    if v_line->>'unit_name' is not null then
      select * into v_unit
        from product_units
        where product_id = v_product.id and unit_name = (v_line->>'unit_name');
      if not found then
        raise exception 'وحدة البيع غير موجودة لهذا المنتج';
      end if;
      v_unit_price := v_unit.sale_price;
      v_cost_price := round(v_product.cost_price * v_unit.conversion_factor, 2);
      v_unit_label := v_unit.unit_name;
      v_conversion_factor := v_unit.conversion_factor;
    else
      v_unit_price := v_product.sale_price;
      v_cost_price := v_product.cost_price;
      v_unit_label := null;
      v_conversion_factor := 1;
    end if;

    -- Authoritative stock check-and-decrement — moved here from add-to-cart
    -- time (see migration header). Checked/applied against v_product.quantity
    -- read UNDER THE LOCK just now, not a value the client's cart snapshot
    -- carried. Any exception here (or later in this loop/function) rolls
    -- back this decrement along with everything else in this call.
    if v_quantity * v_conversion_factor > v_product.quantity then
      raise exception 'الكمية المتوفرة من % غير كافية', v_product.name;
    end if;

    update products
    set quantity = quantity - (v_quantity * v_conversion_factor),
        updated_at = now()
    where id = v_product.id;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    insert into _resolved_lines values (
      v_product.id, v_product.name, v_product.barcode, v_quantity,
      v_unit_price, v_cost_price, v_unit_label, v_conversion_factor, v_line_total
    );
  end loop;

  if p_discount_amount > v_subtotal then
    raise exception 'قيمة الخصم أكبر من إجمالي الفاتورة';
  end if;

  v_total_amount := greatest(v_subtotal - p_discount_amount, 0);

  if p_payment_method = 'credit' then
    v_paid_amount := 0;
    v_change_amount := 0;
  else
    v_paid_amount := p_paid_amount;
    v_change_amount := greatest(p_paid_amount - v_total_amount, 0);
  end if;

  insert into sales (
    id, invoice_number, cashier_id, subtotal, discount_amount, total_amount,
    paid_amount, change_amount, payment_method, customer_id, store_id
  ) values (
    coalesce(p_client_sale_id, gen_random_uuid()),
    coalesce(p_client_invoice_number, 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 9000 + 1000)::text, 4, '0')),
    v_cashier_id, v_subtotal, p_discount_amount, v_total_amount,
    v_paid_amount, v_change_amount, p_payment_method,
    case when p_payment_method = 'credit' then p_customer_id else null end,
    v_store_id
  )
  returning * into v_sale;

  insert into sale_items (
    sale_id, product_id, product_name, barcode, quantity, unit_price,
    total_price, unit_label, unit_conversion_factor, cost_price, store_id
  )
  select v_sale.id, product_id, product_name, barcode, quantity, unit_price,
         total_price, unit_label, unit_conversion_factor, cost_price, v_store_id
  from _resolved_lines;

  if p_payment_method = 'credit' then
    insert into customer_transactions (customer_id, type, amount, sale_id, store_id)
    values (p_customer_id, 'sale', v_total_amount, v_sale.id, v_store_id);
  end if;

  return next v_sale;
end;
$$;

grant execute on function public.create_sale_atomic(jsonb, numeric, text, uuid, numeric, uuid, text) to authenticated;

-- adjust_product_stock (migration 3) remains in use solely for
-- services/products.service.ts#incrementStock's restore/release calls
-- (cancelHeldSale, and resumeHeldSale's new release step in migration 43's
-- accompanying TypeScript changes) — it is never called for reservation
-- purposes anymore, anywhere in this app.
