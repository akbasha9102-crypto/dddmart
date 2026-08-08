# Multi-Tenancy Data Foundation (Phase 1 of 3) — Design

## Problem

dddmart is built for exactly one store — the live client's data and every
Supabase RLS policy assume a single implicit tenant (policies are uniformly
`using (true)`; there is no `store_id`/`tenant_id` anywhere in the schema).

The business goal is to turn dddmart into a product sellable to many
different supermarket owners, each with completely isolated data (own
products, inventory, sales — never visible to another store), eventually
managed from a separate super-admin panel that creates store logins and
toggles subscriptions.

This is **phase 1 of 3**: the data foundation only.
- Phase 2 (later): a subscription-status gate — if a store's subscription is
  turned off, the app shows a "subscription paused" screen instead of the
  normal site.
- Phase 3 (later): the super-admin control panel itself, hosted alongside
  delivery-next, which creates store accounts and toggles phase 2's
  subscription flag. Not designed here.

**The hard constraint:** the current real client's live data must become
"store #1" with zero downtime and zero risk of being locked out mid-migration.

## Goals (confirmed with user)

- Multiple stores, each with fully isolated data (products, sales, customers,
  inventory — nothing crosses between stores).
- The existing live client keeps working through the migration with no
  disruption — this is the standing requirement discussed with the client
  before any code is touched.
- Everything else (subscription gating, the admin panel that creates
  stores) is out of scope for this phase — those come next, once this
  foundation is live and verified.

## Data model

### New table: `stores`

```sql
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
```

`is_active` is the one field borrowed early from phase 2's scope — cheap to
add now, defaults safely, lets phase 2 start reading it without another
migration touching every table again. No `store_settings` sibling table
(unlike delivery-next's `restaurant_settings`): dddmart has no per-store
configurable business settings today (confirmed — `/settings` is just a
sign-out screen), so a settings table would be speculative until a real need
shows up.

### `store_id` added to every existing table

Every one of the 12 existing tables (`profiles`, `categories`, `products`,
`sales`, `sale_items`, `product_units`, `operations_log`, `returns`,
`stock_damages`, `held_sales`, `customers`, `customer_transactions`) gets an
explicit `store_id uuid not null references stores(id)`.

A few of these (`sale_items`, `returns`, `customer_transactions`) could
technically inherit their store via a parent FK (`sale_id`, `customer_id`)
instead of carrying their own column. We're adding the column explicitly
anyway, on purpose:
- Every RLS policy becomes the same one-line pattern
  (`store_id = current_store_id()`), instead of some tables needing a
  cheaper flat check and others needing a subquery join — one consistent
  pattern is much easier to get right and to review.
- Several existing FKs (`stock_damages.product_id`, `returns.product_id`)
  are `on delete set null` — if a product is ever hard-deleted, a
  policy that depends on that FK chain loses its ability to tell which
  store a row belongs to. An explicit, non-nullable `store_id` on the row
  itself doesn't have that failure mode.
- The reporting queries in `sales.service.ts` (daily summary, trends,
  product/category ranking) filter `sale_items`/`returns` directly, not
  through a join back to `sales` — a flat indexed `store_id` column is
  materially cheaper than forcing a join on every report query.

### Uniqueness constraints become per-store

Two constraints are currently global and must become scoped:
- `products.barcode` (globally unique today) → `unique (store_id, barcode)`
  — two different stores legitimately stocking the same manufacturer barcode
  is normal and must not collide.
- `sales.invoice_number` (globally unique today) → `unique (store_id, invoice_number)`.
- Same fix for `product_units.barcode`, plus the trigger functions that
  cross-check barcode uniqueness between `products` and `product_units` get
  rescoped to compare within the same store only.

### How a logged-in user maps to a store

`profiles.store_id` (not a separate join table — no user needs to belong to
more than one store today, and adding that later is a purely additive change
if it's ever needed). A small helper function resolves "which store is the
current logged-in user in" once, and every RLS policy uses it:

```sql
create or replace function public.current_store_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select store_id from public.profiles where id = auth.uid();
$$;
```

Every existing `using (true)` policy across all 12 tables becomes
`using (store_id = current_store_id())` (and the matching `with check` for
insert/update policies). This is the actual isolation mechanism — enforced
by the database itself, not by application code remembering to filter.

**A pre-existing gap this migration must close, not reintroduce:** the
current "update your own profile" policy has no `with check` at all, meaning
a cashier can technically already rewrite arbitrary columns on their own
profile row. Once `store_id` exists, that gap would let a cashier hop
themselves into another store's data by rewriting their own `store_id`. The
new policy explicitly locks `store_id` from being self-editable.

### New-employee signup and "first user becomes admin"

Creating a new employee login goes through a database trigger that fires
automatically whenever an account is created — that trigger has no way to
know which store the new employee belongs to on its own, so the store id is
passed through alongside the employee's name when the account is created
(same channel already used to pass the employee's name today), and the
trigger reads it from there.

Separately, today "the very first login in the whole system becomes admin"
— that rule must change to "the first login **for a given store** becomes
that store's admin," since a future store #2 needs its own first user to
become its own admin. This is a deliberate, necessary behavior change (not
an accidental side effect) that sets up phase 3's "create a new store"
flow to work correctly from day one.

## Migration plan (zero-downtime, ordered)

Postgres migrations in this repo run as a single transaction, which is used
here as the actual safety mechanism — the risky part (switching every
policy from "everyone sees everything" to "only your store") either fully
succeeds or fully rolls back with the live app untouched.

1. **Create `stores`, insert "store #1"** for the real client, with a fixed
   pre-chosen id written into the migration file (not randomly generated),
   so it's reproducible and everyone reviewing the migration knows exactly
   which row is the real client.
2. **Add `store_id` to all 12 tables as nullable**, no RLS changes yet. Full
   stop here is 100% safe — the live app doesn't reference `store_id`
   anywhere yet, so this step alone changes nothing observable.
3. **Backfill**: set every existing row's `store_id` to store #1's id. Since
   today's data is genuinely single-tenant, "everything belongs to store #1"
   is unconditionally correct — no ambiguous rows to reason about.
4. **Verify**: confirm zero rows anywhere still have a blank `store_id`
   before proceeding (manual check, not just relying on the next step to
   catch it).
5. **Tighten**: make `store_id` required, add the new per-store uniqueness
   constraints, update the barcode-uniqueness trigger functions.
6. **Cut over RLS**: atomically (same transaction as step 5) replace every
   "everyone sees everything" policy with "only your store." This is the
   single highest-risk moment — because it's one transaction, it's all
   green or all rolled back, with no partially-migrated state the live app
   could ever hit mid-flight.
7. **Update the new-employee trigger and first-admin logic** to be
   store-aware (same transaction), so no window exists where a new hire
   could land with a blank store.
8. **Manual smoke test against production**, before telling the client
   anything changed: log in as the real admin, load the POS screen, scan/add
   an item, complete a sale, check employees/customers/archive/inventory all
   load — then, separately, create a throwaway second test account under a
   fake second store and confirm it sees **none** of store #1's data. That
   last check is the actual proof multi-tenancy works, not just that
   nothing broke.

If anything fails in steps 5–7, the transaction rolls back and the live app
is untouched (still on the pre-migration schema). Steps 1–4 are individually
safe to leave in place either way — an unused nullable column harms nothing
while a fix is prepared and retried.

## Application-code impact

Because isolation is enforced by the database (RLS), most existing reads,
updates, and deletes across the service layer (`services/*.service.ts`)
**keep working unchanged** — the database transparently hides rows that
belong to another store, with no code change required to filter them.

The real changes are narrower:

- **Every place that creates a new row** (new product, new sale, new
  customer, holding an invoice, logging an operation, etc. — roughly a
  dozen call sites across the service layer) needs to say which store the
  new row belongs to, the same way these functions already take an
  `actorId`/`cashierId` today.
- **`AuthContext`** (the one place in the app that already resolves "who is
  logged in") also resolves "which store are they in," and hands that down
  to every screen exactly the way it already hands down the user's role
  today.
- **The employee-management API routes** (`/api/employees/*`) are the one
  place in the app that talks to Supabase with an admin key that bypasses
  the database's row-checking entirely — those routes need an explicit,
  in-code check that an admin can only view/deactivate employees at their
  own store. Without this, this is a real gap (not hypothetical) where an
  admin could deactivate another store's employee by guessing an id, since
  the usual database-level protection doesn't apply to this one admin-key
  path.

## Testing

Existing service-layer tests run against a mocked Supabase client, so they
won't by themselves prove that database-level isolation actually works.
Real proof comes from the manual smoke test in migration step 8 (the
"create a second store, confirm it sees nothing from store #1" check) —
automated integration tests against a real Postgres instance would be a
reasonable follow-up but are not required to ship this phase safely.

## Known trade-offs / things intentionally deferred

- No `store_settings` table yet (no real per-store configurable settings
  exist today — add one when a genuine need shows up, not speculatively).
- No multi-store-per-user support (`profiles.store_id` is a single column,
  not a join table) — no current requirement for one login to work across
  stores; purely additive to add later if that ever changes.
- Subscription status (`stores.is_active` beyond the one boolean) and the
  admin panel that manages it are phase 2/3, not this migration.
- The offline product cache (IndexedDB) is not cleared on sign-out today.
  Harmless while there's one store, but worth fixing before any real
  multi-store testing happens on a shared device, so it doesn't leak one
  store's cached catalog to whoever logs in next on the same phone.
