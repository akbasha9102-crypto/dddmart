-- Two related fixes to `categories`, both stemming from the same root cause
-- (migration 00000000000001 predates multi-tenancy and was never revisited
-- when 00000000000012 added store_id everywhere else):
--
-- 1. categories_name_key is still a GLOBAL unique(name) constraint. Once
--    multiple stores exist, any two stores picking the same category name
--    (e.g. "حلويات") collide: the second store's insert throws 23505, and
--    createCategory()'s duplicate-recovery re-fetch (services/categories.
--    service.ts) has no store filter, so RLS hides the other store's row
--    and .single() throws — surfaces to the user as "تعذر حفظ القسم".
--    Fix: replace with UNIQUE (store_id, name), matching how
--    products_barcode_key was already correctly handled in migration 12.
--
-- 2. Only the original store (seeded in migration 1) ever received the
--    full curated category list; every store created since multi-tenancy
--    only has whatever its owner manually typed (0-2 categories each) —
--    which is exactly what made (1) so easy to hit in practice. This
--    migration also: fixes a pre-existing typo in the original seed list,
--    adds 3 commonly-needed categories, backfills every existing store
--    with any of the resulting 22 defaults it's missing (by exact name;
--    never touches a store's own custom categories), and adds a trigger so
--    every future new store is auto-seeded with the full default set.

-- ============================================================================
-- Step 1: categories.name uniqueness — global -> per-store.
-- ============================================================================

alter table categories drop constraint if exists categories_name_key;
alter table categories add constraint categories_store_id_name_key unique (store_id, name);

-- ============================================================================
-- Step 2: Fix pre-existing typo in the original default set.
-- "وعزدية" is not a word — intended "عامة" (general). Renamed store-by-store
-- (not a blanket UPDATE ... WHERE name = ...) so it only touches rows that
-- are actually still the untouched default, never a store's own edit that
-- happens to collide (extremely unlikely given the typo, but consistent
-- with "never touch a store's own data" throughout this migration).
-- ============================================================================

update categories
set name = 'مواد غذائية عامة'
where name = 'مواد غذائية وعزدية';

-- ============================================================================
-- Step 3: Backfill every existing store with any of the 22 default
-- categories it's missing, matched by exact name. Never touches a store's
-- own custom categories (e.g. "ببسي", "جبس", "شيبس", "قرطاسية") — this is
-- a pure additive INSERT, no UPDATE/DELETE of existing rows beyond the
-- rename in step 2. Idempotent via the new (store_id, name) constraint.
-- ============================================================================

insert into categories (store_id, name, sort_order, icon)
select s.id, d.name, d.sort_order, d.icon
from stores s
cross join (values
  ('خضروات وفواكه', 10, 'carrot'),
  ('لحوم ومجمدات', 20, 'beef'),
  ('ألبان وأجبان', 30, 'milk'),
  ('بيض', 40, 'egg'),
  ('مخبوزات', 50, 'croissant'),
  ('مواد غذائية عامة', 60, 'shopping-basket'),
  ('معلبات', 70, 'can'),
  ('بهارات وتوابل', 80, 'flame'),
  ('زيوت وسمن', 90, 'droplet'),
  ('أرز وحبوب', 100, 'wheat'),
  ('مشروبات', 110, 'cup-soda'),
  ('عصائر', 120, 'citrus'),
  ('شاي وقهوة', 125, 'cup-soda'),
  ('مياه', 128, 'droplet'),
  ('حلويات وشوكولاتة', 130, 'candy'),
  ('بسكويت ووجبات خفيفة', 140, 'cookie'),
  ('منظفات ومواد تنظيف', 150, 'spray-can'),
  ('عناية شخصية', 160, 'sparkles'),
  ('مستلزمات أطفال', 165, 'sparkles'),
  ('سجائر ودخانيات', 170, 'cigarette'),
  ('قرطاسية ومستلزمات منزلية', 180, 'pencil'),
  ('أخرى', 999, 'ellipsis')
) as d(name, sort_order, icon)
on conflict (store_id, name) do nothing;

-- ============================================================================
-- Step 4: Auto-seed future stores. Every new row in `stores` gets the same
-- 22 default categories inserted for it, scoped to the new store's id.
-- on conflict is defensive (a brand-new store can't yet have any category
-- rows, but keeps this trigger safe to ever re-run/replay).
-- ============================================================================

create or replace function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into categories (store_id, name, sort_order, icon)
  values
    (new.id, 'خضروات وفواكه', 10, 'carrot'),
    (new.id, 'لحوم ومجمدات', 20, 'beef'),
    (new.id, 'ألبان وأجبان', 30, 'milk'),
    (new.id, 'بيض', 40, 'egg'),
    (new.id, 'مخبوزات', 50, 'croissant'),
    (new.id, 'مواد غذائية عامة', 60, 'shopping-basket'),
    (new.id, 'معلبات', 70, 'can'),
    (new.id, 'بهارات وتوابل', 80, 'flame'),
    (new.id, 'زيوت وسمن', 90, 'droplet'),
    (new.id, 'أرز وحبوب', 100, 'wheat'),
    (new.id, 'مشروبات', 110, 'cup-soda'),
    (new.id, 'عصائر', 120, 'citrus'),
    (new.id, 'شاي وقهوة', 125, 'cup-soda'),
    (new.id, 'مياه', 128, 'droplet'),
    (new.id, 'حلويات وشوكولاتة', 130, 'candy'),
    (new.id, 'بسكويت ووجبات خفيفة', 140, 'cookie'),
    (new.id, 'منظفات ومواد تنظيف', 150, 'spray-can'),
    (new.id, 'عناية شخصية', 160, 'sparkles'),
    (new.id, 'مستلزمات أطفال', 165, 'sparkles'),
    (new.id, 'سجائر ودخانيات', 170, 'cigarette'),
    (new.id, 'قرطاسية ومستلزمات منزلية', 180, 'pencil'),
    (new.id, 'أخرى', 999, 'ellipsis')
  on conflict (store_id, name) do nothing;
  return new;
end;
$$;

drop trigger if exists on_store_created_seed_categories on stores;
create trigger on_store_created_seed_categories
  after insert on stores
  for each row execute procedure public.seed_default_categories();
