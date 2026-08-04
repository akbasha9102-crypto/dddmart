-- Reopen category creation for authenticated users, on top of the fixed
-- seeded defaults from 00000000000001_seed_categories.sql. This is a
-- deliberate, intentional reversal of that migration's select-only RLS
-- policy — the client wants the 19 curated categories to remain permanent
-- defaults, but also wants the ability to add more categories via the app.
-- No update/delete policy is added: the fixed defaults can be added to,
-- but not edited or removed, from the client.

create policy "authenticated insert categories" on categories for insert to authenticated with check (true);
