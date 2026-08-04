-- Fixed supermarket category list for DDD Mart.
-- Categories are now a client-managed fixed list (no free-form creation from
-- the app) — tighten RLS accordingly and seed the standard set.

alter table categories add column if not exists sort_order integer not null default 0;
alter table categories add constraint categories_name_key unique (name);

insert into categories (name, sort_order) values
  ('خضروات وفواكه', 10),
  ('لحوم ومجمدات', 20),
  ('ألبان وأجبان', 30),
  ('بيض', 40),
  ('مخبوزات', 50),
  ('مواد غذائية وعزدية', 60),
  ('معلبات', 70),
  ('بهارات وتوابل', 80),
  ('زيوت وسمن', 90),
  ('أرز وحبوب', 100),
  ('مشروبات', 110),
  ('عصائر', 120),
  ('حلويات وشوكولاتة', 130),
  ('بسكويت ووجبات خفيفة', 140),
  ('منظفات ومواد تنظيف', 150),
  ('عناية شخصية', 160),
  ('سجائر ودخانيات', 170),
  ('قرطاسية ومستلزمات منزلية', 180),
  ('أخرى', 999)
on conflict (name) do nothing;

-- Categories are now a fixed, client-curated list — no client-side
-- insert/update/delete, read-only for authenticated users.
drop policy if exists "authenticated all categories" on categories;
create policy "authenticated read categories" on categories for select to authenticated using (true);
