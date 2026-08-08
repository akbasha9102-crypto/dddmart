-- Hold Sale (تعليق الفاتورة).
--
-- Separate table, not a new status on `sales` — `sales` is treated
-- everywhere in this codebase (daily summary, report details, trend,
-- product ranking, category ranking) as "a completed, paid transaction",
-- so a held/draft row there risks a forgotten status filter silently
-- leaking an unpaid invoice into revenue or profit numbers. Mirrors the
-- existing pattern of separate append-only-ish tables (returns,
-- stock_damages) instead. No stock column here: stock is already
-- decremented at add-to-cart time (see hooks/usePOS.ts), so a held sale's
-- items remain reserved exactly as they were — nothing to track.

create table if not exists held_sales (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid references profiles (id) on delete set null,
  items jsonb not null,
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists held_sales_created_at_idx on held_sales (created_at);

alter table held_sales enable row level security;

create policy "authenticated read held_sales" on held_sales for select to authenticated using (true);
create policy "authenticated insert held_sales" on held_sales for insert to authenticated with check (true);
create policy "authenticated delete held_sales" on held_sales for delete to authenticated using (true);
