-- Adds: soft-delete + color + icon to categories, delete support for
-- products via existing is_active flag, and a new operations_log table for
-- the archive feature. Also grants UPDATE/DELETE RLS on categories.
--
-- CAVEAT: migrations 00000000000001 and 00000000000002 have not yet been
-- applied to the live Supabase project as of this writing.

alter table categories add column if not exists is_active boolean not null default true;
alter table categories add column if not exists color text not null default '#129055';
alter table categories add column if not exists icon text not null default 'shopping-basket';

create policy "authenticated update categories" on categories for update to authenticated using (true) with check (true);
create policy "authenticated delete categories" on categories for delete to authenticated using (true);

update categories set icon = 'carrot' where name = 'خضروات وفواكه';
update categories set icon = 'beef' where name = 'لحوم ومجمدات';
update categories set icon = 'milk' where name = 'ألبان وأجبان';
update categories set icon = 'egg' where name = 'بيض';
update categories set icon = 'croissant' where name = 'مخبوزات';
update categories set icon = 'shopping-basket' where name = 'مواد غذائية وعزدية';
update categories set icon = 'can' where name = 'معلبات';
update categories set icon = 'flame' where name = 'بهارات وتوابل';
update categories set icon = 'droplet' where name = 'زيوت وسمن';
update categories set icon = 'wheat' where name = 'أرز وحبوب';
update categories set icon = 'cup-soda' where name = 'مشروبات';
update categories set icon = 'citrus' where name = 'عصائر';
update categories set icon = 'candy' where name = 'حلويات وشوكولاتة';
update categories set icon = 'cookie' where name = 'بسكويت ووجبات خفيفة';
update categories set icon = 'spray-can' where name = 'منظفات ومواد تنظيف';
update categories set icon = 'sparkles' where name = 'عناية شخصية';
update categories set icon = 'cigarette' where name = 'سجائر ودخانيات';
update categories set icon = 'pencil' where name = 'قرطاسية ومستلزمات منزلية';
update categories set icon = 'ellipsis' where name = 'أخرى';

create table if not exists operations_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  action_type text not null check (
    action_type in (
      'sale_created',
      'product_created', 'product_updated', 'product_deleted',
      'category_created', 'category_updated', 'category_deleted',
      'stock_adjusted'
    )
  ),
  entity_type text not null check (entity_type in ('product', 'category', 'sale', 'stock')),
  entity_id uuid,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operations_log_created_at_idx on operations_log (created_at desc);
create index if not exists operations_log_entity_idx on operations_log (entity_type, entity_id);

alter table operations_log enable row level security;
create policy "authenticated read operations_log" on operations_log for select to authenticated using (true);
create policy "authenticated insert operations_log" on operations_log for insert to authenticated with check (true);
