-- Barcode uniqueness must not block reuse of a soft-deleted product's/unit's
-- barcode. deleteProduct()/deleteProductUnit() only flip is_active = false
-- (services/products.service.ts) — the row, and its barcode, stay in the
-- table forever for historical sale_items snapshots. The plain unique
-- constraints added in 00000000000012_multi_tenancy_foundation.sql and the
-- cross-table check_product_barcode_unique()/check_unit_barcode_unique()
-- triggers from 00000000000005_product_units.sql never excluded inactive
-- rows, so once a product/unit was "deleted," its barcode became
-- permanently unusable by any new product/unit in the same store — bug.
--
-- Fix: replace both plain UNIQUE CONSTRAINTs with partial UNIQUE INDEXes
-- scoped to is_active = true, and add the matching is_active filters to the
-- two cross-table trigger functions. A barcode is only "in use" by a
-- product/unit that's actually active — inactive rows never block reuse.
--
-- Safe on live data: a partial unique index only enforces uniqueness among
-- rows matching its WHERE clause, so any pre-existing inactive duplicates
-- (harmless leftovers from before this fix) do not block index creation.
-- (Pre-flight query run separately confirmed zero duplicate ACTIVE pairs
-- exist today, which is guaranteed anyway since the plain constraints being
-- replaced already forbade any duplicate, active or not.)

-- products.barcode: plain per-store unique -> per-store unique among active rows only.
alter table products drop constraint if exists products_store_id_barcode_key;
create unique index if not exists products_store_id_barcode_active_key
  on products (store_id, barcode)
  where is_active = true;

-- product_units.barcode: plain per-store unique -> per-store unique among active rows only.
alter table product_units drop constraint if exists product_units_store_id_barcode_key;
create unique index if not exists product_units_store_id_barcode_active_key
  on product_units (store_id, barcode)
  where is_active = true;

-- Rescope the cross-table barcode-uniqueness triggers (products <->
-- product_units) to only consider active rows a real conflict. A unit's
-- barcode only truly conflicts with a product if that product is active;
-- a product's barcode only truly conflicts with a unit if BOTH that unit
-- and its own parent product are active (mirrors resolveBarcode()'s
-- product_units!inner(*) + is_active checks on both sides in
-- services/products.service.ts).
create or replace function public.check_product_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if new.is_active and exists (
    select 1
    from product_units pu
    join products p on p.id = pu.product_id
    where pu.barcode = new.barcode
      and pu.store_id = new.store_id
      and pu.is_active = true
      and p.is_active = true
  ) then
    raise exception 'الباركود مستخدم من قبل بوحدة منتج أخرى' using errcode = '23505';
  end if;
  return new;
end;
$$;

create or replace function public.check_unit_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if new.is_active and exists (
    select 1 from products
    where barcode = new.barcode
      and store_id = new.store_id
      and is_active = true
  ) then
    raise exception 'الباركود مستخدم من قبل منتج آخر' using errcode = '23505';
  end if;
  return new;
end;
$$;
