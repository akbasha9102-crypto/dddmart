-- Server-side authoritative price recomputation at checkout — fixes audit
-- finding #2 (mashee_mart_security_audit.md, critical, cross-confirmed by
-- two audit agents).
--
-- The vulnerability: createSale (services/sales.service.ts) inserted
-- directly into `sales`/`sale_items` using unit_price/cost_price taken
-- straight from payload.items — client cart state (CartItem, types/pos.ts).
-- Under the old blanket "authenticated all sales"/"all sale_items" RLS
-- policies (00000000000012_multi_tenancy_foundation.sql:215-221), nothing
-- stopped a caller from bypassing the app's UI/JS entirely and calling the
-- Supabase REST API directly with any unit_price/cost_price/quantity it
-- wanted, checking out an entire cart essentially for free.
--
-- Fix: create_sale_atomic, a security definer RPC that is now the ONLY way
-- to insert into sales/sale_items/customer_transactions(type=sale). It
-- receives only product identity + quantity + payment metadata per line —
-- NEVER a price — and looks up real, current prices from products/
-- product_units itself, computing subtotal/total server-side. This also:
--   * derives store_id via current_store_id() and cashier_id via auth.uid()
--     instead of trusting client-supplied values (same class of fix as
--     00000000000023_admin_only_product_category_writes.sql's
--     adjust_product_stock rewrite; deliberately NOT repeating
--     record_return's flagged p_store_id/p_actor_id pattern —
--     00000000000021_atomic_return_recording.sql);
--   * wraps the sale+items(+credit ledger) insert in one function body,
--     incidentally fixing the "not wrapped in a DB transaction" TODO
--     already noted in createSale's doc comment;
--   * incidentally fixes a separate lower-severity finding (any cashier
--     could UPDATE/DELETE historical invoices directly via the old blanket
--     policies) — confirmed by grepping the whole app: the ONLY .insert()
--     calls anywhere against sales/sale_items were createSale's own (now
--     removed in favor of this RPC); every other reference is a .select().
--   * also closes a related pre-existing gap noticed while writing this
--     function: a credit sale's p_customer_id was never checked against
--     the caller's own store (the old RLS on customer_transactions only
--     checked the row's own store_id column, never that customer_id's
--     underlying customer actually belonged to that store) — a cashier
--     could otherwise record debt against another store's customer. Now
--     hard-checked below, same manual-tenant-check pattern as the
--     per-line product check.
--
-- Line identity: CartItem (types/pos.ts) carries product_id + an optional
-- unit_name/unitConversionFactor snapshot, but never a product_units.id —
-- adding one would cascade into the offline IndexedDB cart schema, out of
-- scope for a security fix. product_units has `unique (product_id,
-- unit_name)` (00000000000005_product_units.sql:18), a safe, collision-
-- free resolution key. Barcode is NOT safe here (product_units.barcode is
-- only unique among ACTIVE rows per store, 00000000000019, so a barcode
-- once reassigned could silently resolve to the wrong row for a stale
-- cart). So each line is (p_product_id, p_unit_name nullable, p_quantity).
--
-- is_active is deliberately NOT enforced as a hard reject: a held sale
-- already reserves stock at add-to-cart time and can be resumed after its
-- product was deactivated (confirmed resumeHeldSale performs no is_active
-- re-check). Hard-rejecting inactive products at checkout would strand
-- that already-decremented stock with no recovery path. This function
-- still prices from whatever row currently exists (active or not) — it
-- only rejects a product that is entirely MISSING or belongs to a
-- DIFFERENT store, both real security/data-integrity boundaries, unlike
-- is_active which is a soft business toggle.
--
-- Returns setof sales only — the caller (services/sales.service.ts#createSale)
-- does a follow-up RLS-scoped select on sale_items by sale_id to assemble
-- the receipt.
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

    select * into v_product from products where id = (v_line->>'product_id')::uuid;
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

-- ============================================================================
-- Lock down sales/sale_items: SELECT only for authenticated, all writes now
-- go exclusively through create_sale_atomic (security definer, bypasses
-- RLS by design). Confirmed via grep: no other code path in the app issues
-- any INSERT/UPDATE/DELETE against either table.
-- ============================================================================

drop policy if exists "authenticated all sales" on sales;
create policy "authenticated select sales" on sales for select to authenticated
  using (store_id = current_store_id());

drop policy if exists "authenticated all sale_items" on sale_items;
create policy "authenticated select sale_items" on sale_items for select to authenticated
  using (store_id = current_store_id());
