# Hold Sale (تعليق الفاتورة) — Design

## Problem

A cashier serving customer A sometimes needs to pause (customer went to grab a
forgotten item) and start ringing up customer B without losing A's in-progress
cart. Today the POS cart (`hooks/useCart.ts`) is plain React state — closing
the tab, refreshing, or starting a new sale loses it entirely.

## Goals (confirmed with user)

- A cashier can hold the current cart and start a fresh one.
- Multiple invoices can be held at once (list, not a single slot).
- Held invoices survive page refresh, browser close, or power loss — must be
  DB-backed, not localStorage/session-only.
- Any cashier can see and resume any held invoice (not scoped to the cashier
  who created it) — supports shift handover.

## Data model

New table `held_sales`, **not** a new `status` on `sales`. The existing
`sales` table is treated everywhere in the codebase (5 reporting surfaces:
daily summary, report details, trend, product ranking, category ranking) as
"a completed, paid transaction." Adding a held/draft state there risks a
forgotten status filter silently leaking an unpaid invoice into revenue or
profit numbers. A separate table mirrors the existing pattern in this repo
(`returns`, `stock_damages` are already separate append-only tables) and
makes it structurally impossible for a held sale to affect sales reporting.

```sql
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
```

Migration file: `supabase/migrations/00000000000010_hold_sale.sql` (next
number after `00000000000009_returns_and_damage.sql`).

`items` stores the serialized `CartItem[]` (see `types/pos.ts`) as JSON —
exact same shape the active cart already uses, so resuming is a direct
deserialize into cart state with no field mapping.

No `update` policy: a held sale is only ever read once (`resume`) or removed
(`resume` or `cancel`), never edited in place.

## Stock handling

Stock is already decremented at add-to-cart time (`decrementStock` /
`applyLocalStockDelta`, called from `hooks/usePOS.ts`), not at checkout. This
means:

- **Hold**: no stock action needed — the items are already reserved.
- **Resume**: no stock action needed — items go back into the active cart,
  stock stays reserved as it already was.
- **Cancel/discard** (customer never came back): must call `incrementStock`
  for each line item (converted to base units via
  `toBaseUnits(item.quantity, item.unitConversionFactor)`, same helper
  `services/returns.service.ts` already uses) to release the reservation
  back to available stock, then delete the `held_sales` row.

## Service layer

New `services/heldSales.service.ts`, following the existing pattern (plain
functions taking a `SupabaseClient<Database>` as first arg):

- `holdSale(supabase, { cashierId, items, discountAmount, note })` — insert a row.
- `listHeldSales(supabase)` — select all, ordered by `created_at` ascending.
- `resumeHeldSale(supabase, id)` — fetch the row, delete it, return its `items`/`discountAmount` for the caller to load into the cart. Delete-then-return (not return-then-delete) is not required here since there's no concurrent-cashier race worse than "two cashiers click resume on the same row within the same second" — acceptable v1 risk, matches the app's existing no-locking approach elsewhere.
- `cancelHeldSale(supabase, id, items)` — call `incrementStock` for each item, then delete the row.

## UI

**POS page (`app/(dashboard)/pos/page.tsx`)**

- New "تعليق" (Hold) button next to the existing "دفع"/"تفريغ السلة" buttons. Disabled when the cart is empty. On click: small inline prompt for an optional note (e.g. customer name), then calls `holdSale` and clears the active cart (`cart.clear()`, mirroring what "تفريغ السلة" already does, just preceded by the DB insert).
- New "الفواتير المعلقة" button in the page header, next to the existing "المرتجعات" button, showing a badge with the current held count.

**Held sales list (new component, modal)**

- Row per held sale: note (or a placeholder like "بدون اسم") · item count · total · relative hold time.
- Per-row actions: **استرجاع** (resume) and **حذف** (cancel, with a confirm step since it's irreversible and releases stock).
- **Resume guard**: if the active cart is non-empty when "استرجاع" is pressed, block with a message asking the cashier to hold or clear the current cart first — never silently overwrite an in-progress cart.

## Testing

- `typecheck`, `lint`, `build` must pass.
- Unit tests for `heldSales.service.ts` (mirroring `returns.service.test.ts` style): hold inserts correctly, resume deletes-and-returns, cancel calls `incrementStock` per line and deletes the row.
- Manual verification: hold a cart with 2+ lines, refresh the page, confirm it's still listed; hold two invoices and resume them out of order; cancel a held invoice and confirm the product's stock count in `StockTable` goes back up; attempt to resume while the active cart has items and confirm the guard message appears instead of overwriting.
