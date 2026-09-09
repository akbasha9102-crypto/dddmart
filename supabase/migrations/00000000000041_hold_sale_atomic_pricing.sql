-- held_sales.items stored the client's full CartItem[] verbatim via a plain
-- `.from("held_sales").insert(...)`, including client-supplied unitPrice/
-- costPrice, with nothing re-deriving those prices server-side -- closes an
-- open finding from the ongoing security-audit remediation series (same
-- audit as migrations 00000000000021-00000000000040; documented as finding
-- #4 in ddd_mart_security_audit.md, "Unvalidated Client-Supplied Pricing in
-- held_sales"). Findings #1/#2 from this same audit were already fixed via
-- the identical RPC pattern in migrations 00000000000039 (record_return)
-- and 00000000000040 (record_damage).
--
-- The finding: services/heldSales.service.ts#holdSale inserted directly
-- into held_sales with params.items cast straight through -- unlike sales/
-- sale_items (locked to create_sale_atomic, migration 27) and
-- stock_damages/returns (locked to record_damage/record_return). Currently
-- NOT exploitable for a fabricated paid sale -- resuming a held sale only
-- loads the stored items back into the active cart, and the actual
-- money-moving step (checkout -> createSale -> create_sale_atomic)
-- re-derives price from product_id/unit_name again, ignoring whatever
-- unitPrice/costPrice sits in the resumed cart item. But it is a
-- defense-in-depth gap: nothing stops a caller from inserting arbitrary
-- unitPrice/costPrice into held_sales.items directly via the raw REST API,
-- and if any future code (a report, an export, an analytics query) ever
-- reads held_sales.items[].unitPrice as authoritative pricing, it would be
-- trusting unvalidated data. RLS structurally cannot reach into a JSONB
-- column's internal fields, so this cannot be fixed with a CHECK/policy --
-- it requires moving the write behind a function that re-derives price.
--
-- Fix: a new atomic RPC, hold_sale, that re-resolves unit_price/cost_price
-- per line from the live products/product_units tables using the EXACT
-- same resolution logic as create_sale_atomic's per-line loop (migration
-- 27) -- a held sale can specify a unit_name just like a real sale line
-- can, so the same product/product_units lookup, the same tenant check,
-- and the same 'وحدة البيع غير موجودة لهذا المنتج' error apply verbatim.
-- Unlike create_sale_atomic, this function does not touch products.quantity
-- or sales/sale_items at all -- holding a sale never moves stock or money,
-- it only snapshots correctly-priced line data into held_sales.items.
--
-- JSONB shape: held_sales.items is stored with the SAME camelCase keys
-- CartItem uses in TypeScript (productId, unitPrice, costPrice, unitName,
-- unitConversionFactor, availableStock) -- NOT snake_case column names --
-- because services/heldSales.service.ts's resumeHeldSale and
-- components/features/pos/HeldSalesList.tsx both cast the stored items
-- straight to CartItem[] and read camelCase fields directly. Every
-- non-price field the client sent per line (name, barcode, quantity,
-- availableStock, unitName, unitConversionFactor) is passed straight
-- through unchanged; only unitPrice/costPrice are overwritten with the
-- server-resolved values. quantity/availableStock/name/barcode/unitName/
-- unitConversionFactor remain client-supplied display/identity fields --
-- not financial values, not in scope, same trust level already accepted
-- elsewhere for non-price display fields (e.g. record_damage's
-- p_product_name).
--
-- cashier_id is deliberately left untouched -- still a plain, client-
-- supplied p_cashier_id parameter, NOT derived from auth.uid(). This was
-- audited separately ("held_sales.cashier_id is client-supplied") and
-- explicitly decided NOT to fix: held sales are an intentionally
-- shared-till feature (any same-store authenticated user can already
-- read/insert/delete any held sale by design), so misattributed
-- cashier_id was assessed as a bookkeeping-only issue, not a real
-- vulnerability -- no fix pushed unless the product decision changes.
--
-- store_id, by contrast, IS derived server-side from current_store_id()
-- (never a client-supplied argument) -- matching the same "never trust a
-- client-supplied store_id" precedent as every other atomic RPC in this
-- codebase (create_sale_atomic, record_return, record_damage,
-- record_reconciliation).
--
-- p_discount_amount >= 0 is validated inside the function (same phrasing
-- as create_sale_atomic's own discount check) rather than relying solely
-- on held_sales' existing `check (discount_amount >= 0)` table constraint,
-- so a violation surfaces as a clean Arabic exception instead of a raw
-- Postgres constraint-violation message.
--
-- security definer is required for the same reason as create_sale_atomic/
-- record_return/record_damage: this function must read products/
-- product_units (fine, both already have permissive authenticated-read
-- policies) and write held_sales on behalf of any same-store authenticated
-- user regardless of who owns what -- but it bypasses RLS entirely, so the
-- manual tenant check on each resolved product (identical wording to
-- create_sale_atomic: 'المنتج لا يتبع هذا المتجر') is mandatory, not
-- optional.
--
-- After this function exists, the direct INSERT policy on held_sales is
-- dropped so the RPC becomes the sole write path -- mirroring migration 40
-- for stock_damages. Confirmed via grep across the whole app: the ONLY
-- `.from("held_sales").insert(...)` call site anywhere was
-- services/heldSales.service.ts#holdSale itself (now rewritten below to
-- call this RPC instead); lib/offline/syncManager.ts's offline-replay path
-- also only ever calls the imported holdSale() service function, never a
-- raw insert, so both the online and offline-replay paths are covered by
-- this single RPC. SELECT and DELETE policies are untouched -- reading and
-- resuming/cancelling held sales is still open to any same-store
-- authenticated user, unchanged from today (this is the shared-till
-- feature referenced above).

create function public.hold_sale(
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
  -- create_sale_atomic's loop (migration 27), since a held sale's line can
  -- specify a unit_name exactly like a real sale line. Every other
  -- client-supplied field on the line (name, barcode, quantity,
  -- availableStock, unitName, unitConversionFactor) is read straight
  -- through unchanged; only unitPrice/costPrice are overwritten below.
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from products where id = (v_line->>'productId')::uuid;
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
    else
      v_unit_price := v_product.sale_price;
      v_cost_price := v_product.cost_price;
    end if;

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

-- hold_sale is now the sole write path for held_sales -- direct client
-- INSERTs are closed off, mirroring sales/sale_items/stock_damages/returns
-- after their own atomic RPCs shipped. SELECT and DELETE are untouched
-- (still open to any same-store authenticated user -- held sales are an
-- intentionally shared-till feature, see this migration's header).
drop policy if exists "authenticated insert held_sales" on held_sales;
