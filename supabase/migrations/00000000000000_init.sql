-- DDD Mart initial schema: profiles, categories, products, sales, sale_items.
-- Mirrors types/database.types.ts — keep both in sync when the schema changes.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null default 'cashier' check (role in ('admin', 'cashier')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  barcode text not null unique,
  category_id uuid references categories (id) on delete set null,
  cost_price numeric(12, 2) not null default 0,
  sale_price numeric(12, 2) not null,
  quantity integer not null default 0,
  min_stock_threshold integer not null default 5,
  unit text not null default 'قطعة',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_barcode_idx on products (barcode);
create index if not exists products_category_id_idx on products (category_id);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  cashier_id uuid references profiles (id) on delete set null,
  subtotal numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null,
  paid_amount numeric(12, 2) not null,
  change_amount numeric(12, 2) not null default 0,
  payment_method text not null default 'cash' check (payment_method in ('cash')),
  created_at timestamptz not null default now()
);

create index if not exists sales_created_at_idx on sales (created_at);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  barcode text not null,
  quantity integer not null,
  unit_price numeric(12, 2) not null,
  total_price numeric(12, 2) not null
);

create index if not exists sale_items_sale_id_idx on sale_items (sale_id);

-- Row Level Security: any authenticated employee can operate the till and
-- manage stock. Tighten to role-based policies once admin/cashier
-- permissions need to diverge (e.g. only admins editing cost price).
alter table profiles enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;

create policy "authenticated read profiles" on profiles for select to authenticated using (true);
create policy "self update profile" on profiles for update to authenticated using (auth.uid() = id);

create policy "authenticated all categories" on categories for all to authenticated using (true) with check (true);
create policy "authenticated all products" on products for all to authenticated using (true) with check (true);
create policy "authenticated all sales" on sales for all to authenticated using (true) with check (true);
create policy "authenticated all sale_items" on sale_items for all to authenticated using (true) with check (true);

-- Auto-create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), 'cashier');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
