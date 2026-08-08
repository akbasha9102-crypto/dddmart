# Subscription Gate (dddmart, phase 2) + Store Super-Admin Panel (delivery-next, phase 3) — Design

## Problem

Phase 1 (shipped) made dddmart multi-tenant. This phase makes it a real
product the owner can sell: a super-admin panel (hosted in delivery-next,
completely separate from the existing restaurant panel) creates a login for
a new store and turns its subscription on/off; when off, that store's
dddmart site stops working and shows a clear notice instead.

## Urgent fix found during design, unrelated to being "new" work

The `stores` table (added in phase 1) was never given RLS policies — today
any request with dddmart's public anon key can read or **write** it
directly (e.g. flip any store's `is_active`), no login required. Not
exploited yet (nothing reads `is_active` for gating yet), but this is a
live hole and gets closed as the very first step below, independent of
everything else in this phase.

## Goals (confirmed with user)

- Store super-admin panel is fully separate from the restaurant one:
  separate URL, separate data, never touches restaurant code/tables.
- Same super-admin login (same password) works for both panels, just
  reached from a different page — confirmed acceptable, not worth a second
  password to remember/rotate for a single-operator business.
- Panel does exactly three things: list stores, create a store (+ its first
  login), toggle a store's subscription on/off.
- Off = the store's dddmart site stops working for its users, with a clear
  message, not a broken/blank page — enforced for page navigation **and**
  API calls.

## Part A — dddmart changes

### A1. Close the `stores` RLS gap

```sql
alter table stores enable row level security;

create policy "authenticated read own store" on stores for select to authenticated
  using (id = current_store_id());
```

No insert/update/delete policy for anyone — store creation and the
subscription toggle only ever happen through delivery-next's service-role
client, which bypasses RLS by design. Zero policies for writes is the
correct default-deny state; no guard trigger needed (delivery-next's
equivalent restaurant-suspend trigger exists only because that table
already had broad owner/manager write access to carve an exception out of —
`stores` starts with none).

### A2. Fail-closed at the database layer

`current_store_id()` (from phase 1) starts also requiring the store to be
active:

```sql
create or replace function public.current_store_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select p.store_id
  from public.profiles p
  join public.stores s on s.id = p.store_id
  where p.id = auth.uid() and s.is_active = true;
$$;
```

Since every table's RLS already checks `store_id = current_store_id()`, a
suspended store's every query across every table returns nothing / rejects
every write, automatically, with no per-table changes — a true last line of
defense that also covers any future code path someone adds later and
forgets to gate explicitly.

### A3. Middleware gate (the actual enforcement + friendly message)

`lib/supabase/middleware.ts`, right after the existing session check: fetch
the caller's `stores.is_active` in the same round-trip as the existing
profile lookup. If `false`:
- Page navigation → redirect to a new `/subscription-paused` page (added to
  the existing public-paths allowlist so it doesn't loop).
- `/api/*` request → return `403 { error: "..." }` directly, so client code
  gets a clean error instead of following a redirect into an HTML page.

If the check itself fails (network/DB hiccup) — **fail open, not closed**.
A false "your subscription is paused" during a transient outage would
directly block a real, paying, active store's sales; only a definite
`is_active === false` blocks anything.

### A4. `AuthContext` — in-session UX

Same profile fetch also selects `stores.is_active`, exposed as
`storeActive: boolean`. The dashboard layout wraps its content with a guard
that shows the same paused message client-side, so a cashier mid-session
sees it without needing to navigate/refresh (middleware already catches
every actual navigation and every API call — this layer is UX polish for
the rare mid-session suspension, not the enforcement boundary itself).

### Rollout order (matters)

Ship A1+A2 first, verified independently (today's one live store is active,
so this is a no-op for it — verify via the same "flip `is_active` to false
manually, confirm the app immediately shows empty/blocked, flip back"
check). Only after that, ship A3+A4 — doing it in this order means the
fail-closed database layer is never live without the friendly UI on top of
it (which would otherwise show a suspended store a confusing blank/broken
screen for the gap between the two deploys, instead of the intended
message).

## Part B — delivery-next changes

### B1. A second, distinctly-named service-role client

New env vars on the VPS (`.env`, never committed): `DDDMART_SUPABASE_URL`,
`DDDMART_SUPABASE_SERVICE_ROLE_KEY` (same values as dddmart's own Vercel
env — two copies of one secret; if it's ever rotated, both copies need
updating). New file `src/lib/supabase/dddmart-admin.ts`, same shape as the
existing `src/lib/supabase/admin.ts` but pointed at these new vars. Only
ever imported from server-only route handlers, never from client
components — same trust boundary the existing admin client already relies
on.

### B2. New, isolated route tree

`src/app/super-admin-dddmart/**` (login + dashboard pages) and
`src/app/api/super-admin-dddmart/**` (`auth`, `stores` list+create,
`stores/[id]` toggle) — a distinct URL prefix from the existing
`super-admin`/`api/super-admin` restaurant routes, not nested under them,
so the "never touches the restaurant panel" requirement is structurally
obvious in the file layout, not just a convention someone has to remember.
Auth check (`isAuthed()`) is copy-pasted rather than shared with the
restaurant routes — a few duplicated lines is the deliberate price for that
isolation, so a future change to one panel's auth can't silently affect
the other's.

The login page reuses the existing `sa_session` cookie / session endpoint
(per the confirmed decision above) — one super-admin login, reached from
two different entry pages.

### B3. Create-store flow (`POST /api/super-admin-dddmart/stores`)

Form: store name, admin's full name, admin email, admin password (super-
admin types it and relays it to the store owner directly — phone/WhatsApp,
same as presumably already happens for restaurant owners; no email-sending
infrastructure exists in either repo to automate this, and building it is
out of scope here).

1. Auth check.
2. Derive a slug from the store name (same generator logic as the
   restaurants route — strip to latin/alnum, hyphenate, timestamp fallback
   for all-Arabic names). Purely an internal identifier — dddmart has no
   per-store URL routing, so this is not user-facing.
3. Check slug uniqueness against dddmart's `stores` table.
4. Insert the `stores` row (`is_active: true`).
5. Create the admin's Supabase Auth user in **dddmart's** project via the
   new admin client, with `user_metadata: { full_name, store_id }` — the
   `store_id` is what dddmart's phase-1 `handle_new_user()` trigger reads
   to assign the new profile to the right store and correctly make them
   that store's first admin.
6. If step 5 fails, delete the store row created in step 4 (clean
   rollback, no orphaned store with no admin).

### B4. Subscription toggle (`PATCH /api/super-admin-dddmart/stores/[id]`)

Single field write: `stores.is_active`. Logged via the existing
`logSuperAdminAction()` audit helper (already action-agnostic by design —
`details: jsonb`, no restaurant-specific schema constraint), with a
descriptive action string (`dddmart_store_activated` /
`dddmart_store_suspended` / `dddmart_store_created`). One shared audit
trail for everything the super-admin does, rather than splitting it across
two Supabase projects.

### B5. Dashboard UI

One page: a table of stores (name, slug, active/suspended, created date)
with an active/suspended toggle per row, and a create-store form. No edit,
no delete, no tiers, no impersonation — deliberately minimal; extend later
only if a real need shows up.

## Rollout order across both repos

1. dddmart A1+A2 (RLS fix + fail-closed function) — ship and verify alone.
2. dddmart A3+A4 (middleware + AuthContext gate + paused page) — ship and
   verify against the live store (should be a no-op; test by manually
   flipping `is_active`).
3. delivery-next B1-B5 — build against dddmart's now-gated project, test
   end-to-end against a disposable throwaway test store (never against the
   real live client's store #1), including confirming a suspended test
   store's `/api/employees` calls correctly refuse, not just its UI.
4. Only after both sides are independently verified is this usable for
   real store onboarding.

## Known trade-offs

- Shared super-admin password across both panels (confirmed acceptable —
  single operator, not worth a second credential to manage).
- Password relay for new store admins is manual (super-admin tells the
  store owner directly) — no automated email/reset-link flow; acceptable
  for the current volume, revisit if this becomes frequent.
- Two independent copies of dddmart's service-role key (Vercel + VPS) —
  both must be updated together if ever rotated.
