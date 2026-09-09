-- Reverses migration 41's documented design decision that "this function
-- does not touch products.quantity or sales/sale_items at all -- holding a
-- sale never moves stock or money" (00000000000041_hold_sale_atomic_pricing.
-- sql). That was correct at the time: stock was decremented at add-to-cart
-- time (hooks/usePOS.ts#addProductToCart), so by the time a cart was held,
-- its stock was already reserved and hold_sale had nothing left to do.
--
-- Migration 42 (00000000000042_checkout_time_stock_decrement.sql) removed
-- that add-to-cart-time decrement entirely, closing a silent-permanent-
-- stock-loss bug (multi_agent_e2e_test_report.md, "خطأ مؤكد #1") by moving
-- checkout's authoritative stock check-and-decrement into create_sale_atomic
-- itself. The cart is now a purely local, advisory, UNRESERVED list — see
-- hooks/usePOS.ts#addProductToCart, rewritten alongside migration 42 to a
-- synchronous function with no RPC/IndexedDB call at all.
--
-- That leaves a gap for held sales specifically: a held sale is a REAL
-- commitment (approved product direction) — a cashier tells a customer "your
-- order is set aside," and the store should not be able to sell that same
-- stock to someone else in the meantime. Since the cart itself no longer
-- reserves anything, hold_sale is now the only remaining moment where a
-- held sale's stock can be genuinely reserved — so this migration adds the
-- IDENTICAL row-locked check-and-decrement logic create_sale_atomic gained
-- in migration 42, applied per line inside hold_sale's existing loop. This
-- matches the same "decrement at the moment of commitment" semantics now
-- used consistently everywhere: checkout commits and decrements
-- (create_sale_atomic, migration 42); holding commits (to a shared till)
-- and decrements (hold_sale, this migration); only the still-being-browsed,
-- not-yet-committed cart never reserves anything.
--
-- Concretely, inside hold_sale's existing per-line loop:
--   1. The existing `select * into v_product from products where id =
--      (v_line->>'productId')::uuid;` gains `for update` — same row-lock
--      reasoning as migration 42, so a concurrent sale/hold/damage/etc.
--      against the same product serializes behind this one.
--   2. hold_sale did not previously have a v_conversion_factor local
--      variable (the old code inlined v_unit.conversion_factor directly and
--      only into the cost_price computation) -- a new `v_conversion_factor
--      integer` is declared and set the exact same way create_sale_atomic
--      sets it (v_unit.conversion_factor when unitName is present, else 1),
--      purely for symmetry/readability with migration 42's twin logic, and
--      because the bounds check below needs it as a standalone value anyway.
--   3. Immediately after unit resolution, the identical bounds-check-and-
--      decrement block from migration 42 is inserted, with the exact same
--      Arabic error message ('الكمية المتوفرة من % غير كافية') for
--      consistency of user-facing behavior between checkout and hold.
--
-- Approved trade-off (explicitly signed off, not a side effect discovered
-- later): a genuinely rare last-unit race between two cashiers -- both
-- viewing a stale "1 in stock" cart at the same instant -- now surfaces as
-- an "insufficient stock" error to whichever of them pays OR holds second,
-- instead of the old silent-permanent-orphan risk this whole change (plus
-- migration 42) exists to eliminate. This is the same trade-off migration 42
-- already accepted for checkout; this migration extends it to hold, since
-- hold now decrements too.
--
-- Same "why not adjust_product_stock" reasoning as migration 42's header:
-- this codebase's convention (record_damage, migration 40) is to inline the
-- row-locked check-and-decrement directly in each single-purpose RPC rather
-- than nesting a call to the generic adjust_product_stock primitive, and
-- hold_sale already raises its own direct, per-line Arabic exceptions for
-- every other validation in this loop (missing product, wrong store,
-- missing unit) -- this is one more, consistent with the rest.
--
-- Downstream TypeScript implication (see services/heldSales.service.ts,
-- updated alongside this migration): resuming a held sale now must RELEASE
-- the stock this function reserved (resumeHeldSale gains an incrementStock
-- call per line, mirroring cancelHeldSale's existing release step) --
-- otherwise the resumed cart's later checkout (-> create_sale_atomic,
-- migration 42) would decrement the exact same stock a second time.
-- cancelHeldSale itself needs no change -- it already releases stock on
-- cancel and that behavior is now simply correct for the right reason
-- (releasing a real reservation) instead of by coincidence.
create or replace function public.hold_sale(
  p_cashier_id uuid,
  p_items jsonb,
  p_discount_amount numeric,
  p_note text,
  p_client_local_id uuid default null
)
returns setof held_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_line jsonb;
  v_product products%rowtype;
  v_unit product_units%rowtype;
  v_unit_price numeric(12,2);
  v_cost_price numeric(12,2);
  v_conversion_factor integer;
  v_resolved_items jsonb := '[]'::jsonb;
begin
  v_store_id := current_store_id();
  if v_store_id is null then
    raise exception 'المتجر غير نشط أو الجلسة غير صالحة';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'لا يمكن تعليق فاتورة فارغة';
  end if;

  if p_discount_amount < 0 then
    raise exception 'قيمة الخصم يجب أن تكون صفراً أو أكبر';
  end if;

  -- Per-line price/cost resolution -- identical logic to
  -- create_sale_atomic's loop (migration 27/42), since a held sale's line
  -- can specify a unit_name exactly like a real sale line. Every other
  -- client-supplied field on the line (name, barcode, quantity,
  -- availableStock, unitName, unitConversionFactor) is read straight
  -- through unchanged; only unitPrice/costPrice are overwritten below.
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    -- Row-locked for the rest of this transaction -- see migration header
    -- and migration 42's identical reasoning: a concurrent sale/hold/damage/
    -- etc. against the same product serializes behind this one instead of
    -- reading a stale quantity.
    select * into v_product from products where id = (v_line->>'productId')::uuid for update;
    if not found then
      raise exception 'المنتج غير موجود';
    end if;
    if v_product.store_id <> v_store_id then
      raise exception 'المنتج لا يتبع هذا المتجر';
    end if;

    if v_line->>'unitName' is not null then
      select * into v_unit
        from product_units
        where product_id = v_product.id and unit_name = (v_line->>'unitName');
      if not found then
        raise exception 'وحدة البيع غير موجودة لهذا المنتج';
      end if;
      v_unit_price := v_unit.sale_price;
      v_cost_price := round(v_product.cost_price * v_unit.conversion_factor, 2);
      v_conversion_factor := v_unit.conversion_factor;
    else
      v_unit_price := v_product.sale_price;
      v_cost_price := v_product.cost_price;
      v_conversion_factor := 1;
    end if;

    -- Authoritative stock check-and-decrement -- a held sale is now a real
    -- commitment and must genuinely reserve stock at hold time (see
    -- migration header). Checked/applied against v_product.quantity read
    -- UNDER THE LOCK just now. Any exception here (or later in this
    -- loop/function) rolls back this decrement along with everything else
    -- in this call -- same atomicity guarantee as create_sale_atomic
    -- (migration 42): the whole function body is one implicit transaction.
    if (v_line->>'quantity')::numeric * v_conversion_factor > v_product.quantity then
      raise exception 'الكمية المتوفرة من % غير كافية', v_product.name;
    end if;

    update products
    set quantity = quantity - ((v_line->>'quantity')::numeric * v_conversion_factor),
        updated_at = now()
    where id = v_product.id;

    -- Same camelCase keys CartItem uses in TypeScript -- resumeHeldSale
    -- and HeldSalesList.tsx both cast held_sales.items straight to
    -- CartItem[] and read these exact field names.
    v_resolved_items := v_resolved_items || jsonb_build_object(
      'productId', v_line->>'productId',
      'name', v_line->>'name',
      'barcode', v_line->>'barcode',
      'unitPrice', v_unit_price,
      'costPrice', v_cost_price,
      'quantity', (v_line->>'quantity')::numeric,
      'availableStock', (v_line->>'availableStock')::numeric,
      'unitName', v_line->>'unitName',
      'unitConversionFactor', (v_line->>'unitConversionFactor')::integer
    );
  end loop;

  return query
    insert into held_sales (
      cashier_id,
      items,
      discount_amount,
      note,
      store_id,
      client_local_id
    )
    values (
      p_cashier_id,
      v_resolved_items,
      p_discount_amount,
      p_note,
      v_store_id,
      p_client_local_id
    )
    returning *;
end;
$$;

grant execute on function public.hold_sale(uuid, jsonb, numeric, text, uuid) to authenticated;
