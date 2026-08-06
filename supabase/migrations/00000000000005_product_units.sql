-- Adds optional multi-level sale units (e.g. كيس, كارتون) on top of a
-- product's existing base unit (the products row itself — never
-- duplicated as a product_units row). Stock stays a single base-unit
-- number on products.quantity; conversion_factor is how many base units
-- one of this unit equals, kept as `integer` so it plugs directly into
-- the existing adjust_product_stock(uuid, integer) RPC with no cast.
create table if not exists product_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  unit_name text not null,
  conversion_factor integer not null check (conversion_factor > 1),
  barcode text not null unique,
  sale_price numeric(12, 2) not null check (sale_price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, unit_name)
);

create index if not exists product_units_product_id_idx on product_units (product_id);

alter table product_units enable row level security;
create policy "authenticated all product_units" on product_units for all to authenticated using (true) with check (true);

-- Cross-table barcode uniqueness: a UNIQUE constraint can't span two
-- tables directly, so each table gets a trigger checking the other.
-- errcode 23505 (unique_violation) is used deliberately so the existing
-- isUniqueViolation() helper in services/products.service.ts already
-- handles this without any changes.
create or replace function public.check_product_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from product_units where barcode = new.barcode) then
    raise exception 'الباركود مستخدم من قبل بوحدة منتج أخرى' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists products_barcode_cross_check on products;
create trigger products_barcode_cross_check
  before insert or update of barcode on products
  for each row execute procedure public.check_product_barcode_unique();

create or replace function public.check_unit_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from products where barcode = new.barcode) then
    raise exception 'الباركود مستخدم من قبل منتج آخر' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists product_units_barcode_cross_check on product_units;
create trigger product_units_barcode_cross_check
  before insert or update of barcode on product_units
  for each row execute procedure public.check_unit_barcode_unique();

-- Historical snapshot of which unit a sale_items line was sold in.
-- Plain columns, not FKs: editing/deleting a product_units row later must
-- never change or break a past invoice. NULL unit_label means the base
-- unit (products.unit) was sold — matches every existing row.
alter table sale_items
  add column if not exists unit_label text,
  add column if not exists unit_conversion_factor integer not null default 1;
