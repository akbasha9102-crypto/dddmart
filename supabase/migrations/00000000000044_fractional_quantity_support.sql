-- Adds support for fractional/weighed quantities (e.g. 1.250 كغم of chicken
-- or produce), approved direction from the 2026-09-09 brainstorming session
-- following the E2E test report's UX finding #2 (ProductForm silently
-- rejected fractional quantities with no error message — this migration is
-- the real fix behind that finding, not just an error-message patch, once
-- the client confirmed the store genuinely sells weighed goods).
--
-- Every quantity-shaped column that can ever hold a weighed product's stock
-- movement changes from `integer` to `numeric(10,3)` (millgram-level
-- precision, e.g. 1.250 kg) — this is NOT limited to products.quantity:
-- sale_items/returns/stock_damages/stock_purchases/stock_reconciliations
-- (including stock_reconciliations.difference, the signed shortage/overage
-- amount, alongside previous_quantity/counted_quantity) all record
-- quantities for the SAME products table rows, so a weighed product must be
-- returnable, damageable, purchasable, and reconcilable in fractional
-- amounts too, or those flows would silently force-round a real physical
-- count to the nearest whole unit.
--
-- What deliberately does NOT change: `conversion_factor` (product_units)
-- and `unit_conversion_factor` (sale_items/returns) stay `integer` — that
-- system is an unrelated whole-number ratio between a product's alternate
-- sale units (e.g. 1 كرتون = 12 قطعة), not a quantity of stock. Per this
-- session's approved design, a `sold_by_weight` product does not
-- participate in the product_units system in this first version (sold only
-- in its own base unit, e.g. كغم) — a deliberate scope cut, not an
-- oversight; can be revisited later if a weighed product ever needs a
-- secondary packaged unit (e.g. a 5kg pre-bagged box).
--
-- New products.sold_by_weight boolean (default false) is the flag the
-- frontend uses to decide whether to offer a decimal weight-entry input
-- instead of the existing integer +/- stepper — existing products are
-- unaffected (default false preserves today's integer-only UX for them),
-- and nothing in this migration forces any existing product to change
-- behavior. products.min_stock_threshold also moves to numeric(10,3) so a
-- weighed product's low-stock alert can be a fractional threshold (e.g.
-- "warn me below 2.5 كغم") — left as integer would silently truncate any
-- fractional threshold a store owner tried to set for a weighed product.
--
-- Two functions needed NO change at all: create_sale_atomic (migration 42)
-- and hold_sale (migration 43) already parse their per-line quantity out of
-- a jsonb payload via `(v_line->>'quantity')::numeric` — jsonb has no
-- static column typing, so both were already fractional-quantity-safe the
-- moment products.quantity itself became numeric below; no signature or
-- body change needed for either.
--
-- Five functions DO need a real signature change, because they take
-- quantity as a plain scalar `integer` parameter rather than parsing it out
-- of jsonb — `create or replace function` cannot change a parameter's type
-- (Postgres resolves function identity by name + argument type list, so
-- replacing `integer` with `numeric` would silently create a SECOND,
-- overloaded function sharing the same name instead of replacing the
-- first, leaving the old integer-only version still callable and making
-- PostgREST's RPC name resolution ambiguous). Each of the five is instead
-- explicitly DROPped by its exact existing signature, then CREATEd fresh
-- with the quantity parameter as `numeric` — bodies are carried over
-- unchanged except for the parameter type itself (and, for
-- record_reconciliation, its one local variable that held the computed
-- difference), since ordinary Postgres arithmetic/comparisons on a numeric
-- value need no other rewriting:
--   - adjust_product_stock(p_product_id uuid, p_delta integer) — latest
--     version is migration 23's security-definer rewrite, not migration 3's
--     original; p_delta becomes numeric.
--   - receive_product_stock(p_product_id uuid, p_added_base_units integer,
--     p_unit_base_cost numeric) — latest version is migration 32's
--     security-definer rewrite, not migration 8's original;
--     p_added_base_units becomes numeric.
--   - record_return(..., p_quantity integer, ..., p_unit_conversion_factor
--     integer, ...) — latest version is migration 39; only p_quantity
--     becomes numeric, p_unit_conversion_factor is untouched (product_units
--     ratio, not a weight).
--   - record_damage(p_product_id uuid, p_product_name text, p_quantity
--     integer, p_reason text) — latest version is migration 40; p_quantity
--     becomes numeric.
--   - record_reconciliation(p_product_id uuid, p_product_name text,
--     p_counted_quantity integer, p_reason text) — latest version is
--     migration 36; p_counted_quantity becomes numeric, and its local
--     `v_difference integer` becomes `v_difference numeric` so the
--     shortage/overage difference itself can be fractional.
--
-- Confirmed via a full repo grep before writing this migration: none of
-- these five functions call each other, and nothing else in the SQL layer
-- calls any of them internally — each is invoked only from its own
-- TypeScript service (services/products.service.ts,
-- services/returns.service.ts, services/damages.service.ts,
-- services/reconciliations.service.ts), so dropping and recreating each in
-- isolation carries no cross-function dependency risk.
--
-- ALTER COLUMN ... TYPE numeric(10,3) on a column that was `integer` is a
-- safe, non-lossy, standard Postgres implicit cast (every integer value is
-- exactly representable as numeric) — no USING clause or data backfill is
-- needed. Existing CHECK constraints referencing these columns (e.g.
-- `quantity > 0`, `counted_quantity >= 0`) remain valid unchanged, since
-- numeric supports the same comparison operators.

alter table products
  alter column quantity type numeric(10, 3),
  alter column min_stock_threshold type numeric(10, 3),
  add column if not exists sold_by_weight boolean not null default false;

-- sale_items_secure (migration 34) has a view rule depending on
-- sale_items.quantity — Postgres refuses ALTER COLUMN ... TYPE on a column
-- any view/rule depends on (no CASCADE option exists for this ALTER form,
-- unlike DROP), so the view must be dropped first and recreated afterward,
-- byte-for-byte identical to migration 34's definition. Dropping a view
-- also drops the grants made directly on it, so `grant select on
-- sale_items_secure to authenticated` (migration 34) is re-issued below —
-- the `revoke select on sale_items from authenticated` from that same
-- migration is a privilege on the base table, not the view, so it is
-- untouched by this and does not need to be repeated.
drop view if exists sale_items_secure;

alter table sale_items
  alter column quantity type numeric(10, 3);

create view sale_items_secure as
select
  id,
  sale_id,
  product_id,
  product_name,
  barcode,
  quantity,
  unit_price,
  total_price,
  unit_label,
  unit_conversion_factor,
  case
    when exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      then cost_price
    else null
  end as cost_price,
  store_id
from sale_items;

grant select on sale_items_secure to authenticated;

alter table returns
  alter column quantity type numeric(10, 3);

alter table stock_damages
  alter column quantity type numeric(10, 3);

alter table stock_purchases
  alter column quantity type numeric(10, 3);

alter table stock_reconciliations
  alter column previous_quantity type numeric(10, 3),
  alter column counted_quantity type numeric(10, 3),
  alter column difference type numeric(10, 3);

-- ============================================================================
-- adjust_product_stock: p_delta integer -> numeric. Body byte-for-byte
-- unchanged from migration 23 otherwise (security definer + manual tenant
-- check + the single atomic `update ... where quantity + p_delta >= 0`
-- guard that is this function's entire concurrency-safety guarantee).
drop function if exists public.adjust_product_stock(uuid, integer);

create function public.adjust_product_stock(p_product_id uuid, p_delta numeric)
returns setof products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_store_id uuid;
begin
  select store_id into v_product_store_id from products where id = p_product_id;

  if not found then
    return;
  end if;

  if v_product_store_id <> current_store_id() then
    raise exception 'المنتج لا يتبع هذا المتجر';
  end if;

  return query
    update products
    set quantity = quantity + p_delta,
        updated_at = now()
    where id = p_product_id
      and quantity + p_delta >= 0
    returning *;
end;
$$;

grant execute on function public.adjust_product_stock(uuid, numeric) to authenticated;

-- ============================================================================
-- receive_product_stock: p_added_base_units integer -> numeric. Body
-- byte-for-byte unchanged from migration 32 otherwise (security definer +
-- manual tenant check + weighted-average cost_price formula).
drop function if exists public.receive_product_stock(uuid, integer, numeric);

create function public.receive_product_stock(
  p_product_id uuid,
  p_added_base_units numeric,
  p_unit_base_cost numeric
)
returns setof products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_store_id uuid;
begin
  select store_id into v_product_store_id from products where id = p_product_id;

  if not found then
    return;
  end if;

  if v_product_store_id <> current_store_id() then
    raise exception 'المنتج لا يتبع هذا المتجر';
  end if;

  return query
    update products
    set quantity = quantity + p_added_base_units,
        cost_price = round(
          (quantity * cost_price + p_added_base_units * p_unit_base_cost)
          / (quantity + p_added_base_units),
          2
        ),
        updated_at = now()
    where id = p_product_id
      and p_added_base_units > 0
      and p_unit_base_cost >= 0
    returning *;
end;
$$;

grant execute on function public.receive_product_stock(uuid, numeric, numeric) to authenticated;

-- ============================================================================
-- record_return: p_quantity integer -> numeric. p_unit_conversion_factor
-- stays integer (product_units ratio, unrelated to weight). Body
-- byte-for-byte unchanged from migration 39 otherwise (row lock on
-- sale_items, server-derived actor/store, refund cap, trusted-locked-row
-- substitution for product_id/product_name/unit_label/
-- unit_conversion_factor, customer-debt reduction).
drop function if exists public.record_return(uuid, uuid, uuid, text, integer, text, integer, numeric, text);

create function public.record_return(
  p_sale_id uuid,
  p_sale_item_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_quantity numeric,
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

  select * into v_sale_item from sale_items where id = p_sale_item_id for update;

  if not found then
    raise exception 'سطر البيع غير موجود';
  end if;

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

  select customer_id into v_customer_id from sales where id = p_sale_id;

  if v_customer_id is not null and p_refund_amount > 0 then
    insert into customer_transactions (customer_id, type, amount, sale_id, store_id, cashier_id)
    values (v_customer_id, 'return', p_refund_amount, p_sale_id, current_store_id(), auth.uid());
  end if;

  return next v_inserted_return;
end;
$$;

grant execute on function public.record_return(uuid, uuid, uuid, text, numeric, text, integer, numeric, text) to authenticated;

-- ============================================================================
-- record_damage: p_quantity integer -> numeric. Body byte-for-byte
-- unchanged from migration 40 otherwise (row lock, tenant check,
-- insufficient-stock check against the locked row, cost_price/loss_amount
-- always server-derived, never client-supplied).
drop function if exists public.record_damage(uuid, text, integer, text);

create function public.record_damage(
  p_product_id uuid,
  p_product_name text,
  p_quantity numeric,
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

  select * into v_product from products where id = p_product_id for update;

  if not found then
    raise exception 'تعذر العثور على المنتج';
  end if;

  if v_product.store_id <> current_store_id() then
    raise exception 'المنتج لا يتبع هذا المتجر';
  end if;

  if p_quantity > v_product.quantity then
    raise exception 'الكمية أكبر من المخزون المتوفر (المتوفر: %)', v_product.quantity;
  end if;

  update products
  set quantity = quantity - p_quantity,
      updated_at = now()
  where id = p_product_id;

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

grant execute on function public.record_damage(uuid, text, numeric, text) to authenticated;

-- ============================================================================
-- record_reconciliation: p_counted_quantity integer -> numeric, and its
-- local v_difference integer -> numeric so a fractional shortage/overage
-- (e.g. counted 0.750 كغم less than system stock) is recorded exactly
-- instead of being truncated. Body otherwise byte-for-byte unchanged from
-- migration 36 (row lock, tenant check, direct SET to the counted value,
-- loss_value only for a shortage).
drop function if exists public.record_reconciliation(uuid, text, integer, text);

create function public.record_reconciliation(
  p_product_id uuid,
  p_product_name text,
  p_counted_quantity numeric,
  p_reason text
)
returns setof stock_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product products%rowtype;
  v_difference numeric;
  v_loss_value numeric;
begin
  select * into v_product from products where id = p_product_id for update;

  if not found then
    raise exception 'تعذر العثور على المنتج';
  end if;

  if v_product.store_id <> current_store_id() then
    raise exception 'المنتج لا يتبع هذا المتجر';
  end if;

  v_difference := p_counted_quantity - v_product.quantity;

  if v_difference = 0 then
    raise exception 'لا يوجد فرق لتسجيله';
  end if;

  update products
  set quantity = p_counted_quantity,
      updated_at = now()
  where id = p_product_id;

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

grant execute on function public.record_reconciliation(uuid, text, numeric, text) to authenticated;
