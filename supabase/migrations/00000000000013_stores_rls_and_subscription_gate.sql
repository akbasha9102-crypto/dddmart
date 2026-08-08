-- Subscription Gate, Part A1+A2 (urgent RLS fix + fail-closed function).
--
-- See docs/superpowers/specs/2026-08-08-subscription-gate-and-store-admin-design.md
-- for the full design.
--
-- A1. The `stores` table (added in phase 1) was never given RLS policies —
-- today any request with dddmart's public anon key can read or write it
-- directly (e.g. flip any store's is_active), no login required. This closes
-- that hole: RLS on, with exactly one policy (authenticated read of one's own
-- store row). No insert/update/delete policy for anyone is intentional — store
-- creation and the subscription toggle only ever happen through
-- delivery-next's service-role client, which bypasses RLS by design. Zero
-- policies for writes is the correct default-deny state.
--
-- A2. current_store_id() (from phase 1) starts also requiring the store to
-- be active. Since every table's RLS already checks
-- store_id = current_store_id(), a suspended store's every query across
-- every table returns nothing / rejects every write automatically, with no
-- per-table changes — a last line of defense that also covers any future
-- code path someone adds later and forgets to gate explicitly.
--
-- No-op for today's one live store: it has is_active = true, so
-- current_store_id() returns exactly what it returned before this
-- migration, and the new stores RLS policy only restricts a read that was
-- never relied upon for cross-store access anyway (this app has always had
-- exactly one store's worth of authenticated users).

-- ============================================================================
-- A1: Enable RLS on stores, add the one read policy.
-- ============================================================================

alter table stores enable row level security;

create policy "authenticated read own store" on stores for select to authenticated
  using (id = current_store_id());

-- ============================================================================
-- A2: current_store_id() now fails closed — a suspended store's users get
-- no store_id back, so every store_id = current_store_id() check across
-- every table's RLS policy stops matching.
-- ============================================================================

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
