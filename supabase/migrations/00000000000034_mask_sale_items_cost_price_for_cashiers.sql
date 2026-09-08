-- Mask sale_items.cost_price from non-admins even via direct REST — fixes
-- audit item (mashee_mart_security_audit.md, "sales/sale_items.cost_price
-- قابل للقراءة من أي كاشير عبر REST المباشر رغم إخفائه من واجهة الكاشير في
-- كل مكان (تسريب هامش الربح)").
--
-- The finding: cost_price is deliberately hidden from cashiers everywhere in
-- the UI (see components/features/sales/SaleReturnPanel.tsx and
-- components/features/sales/InvoiceView.tsx — both grepped and confirmed to
-- never reference .cost_price), but nothing in Postgres actually enforces
-- that. RLS (row-level security) can only ever accept-or-reject an entire
-- ROW — it has no concept of "show this row but blank out one of its
-- columns" — and static per-role column GRANTs can't vary by admin-vs-cashier
-- either, since both share the single `authenticated` Postgres role (same
-- reasoning that has applied to every fix in this series, e.g. migrations
-- 23/28/30/33). So today, any cashier can bypass the UI and call the
-- Supabase REST API directly (`select * from sale_items`) and read the exact
-- wholesale cost of every product ever sold — a profit-margin leak.
--
-- Fix: a plain (non-security-definer) view, sale_items_secure, exposing every
-- column of sale_items unchanged EXCEPT cost_price, which is computed via an
-- inline admin-check CASE (same pattern as migrations 23/28/30/33) — real
-- value for admins, null for everyone else. Because this is a PLAIN view
-- (Postgres default: security_invoker behavior, i.e. NOT `security definer`),
-- it runs with the querying session's own privileges/RLS, so the existing
-- "authenticated select sale_items" policy (store_id = current_store_id())
-- still applies transparently underneath it — a cashier querying the view
-- still only ever sees their own store's rows, same as before. No RLS changes
-- to the base table's SELECT policy are needed or made.
--
-- The raw sale_items table's SELECT grant is then revoked from `authenticated`
-- so the view becomes the ONLY read path for that role — otherwise the
-- vulnerability would remain fully open via a direct query against the base
-- table, view or no view. Confirmed via grep: no INSERT/UPDATE/DELETE policy
-- exists on sale_items (all writes go exclusively through the
-- create_sale_atomic security-definer RPC, migration 00000000000027, which
-- bypasses table grants/RLS entirely since it runs as the function owner) —
-- so this revoke only ever affects reads, never writes.
--
-- IMPORTANT CAVEAT (documented, not silently resolved): this revoke is
-- role-level, not user-level. Postgres privileges cannot vary per-row or
-- per-user, only per-role, and admins and cashiers both connect as the same
-- `authenticated` role. So this migration also blocks ADMINS from querying
-- the raw sale_items table directly (e.g. a manual REST call or Studio table
-- editor while impersonating `authenticated`) — admins must go through
-- sale_items_secure too. This is an accepted consequence of the shared-role
-- constraint named in the audit item itself (there is no "authenticated but
-- also admin" Postgres role to grant to separately), not an oversight, and
-- admin-facing app code has no reason to ever query the raw table (grepped:
-- services/sales.service.ts's 10 call sites are being migrated to the view
-- in this same change; nothing else in the app queries sale_items at all).
--
-- Confirmed via services/sales.service.ts's own JSDoc + migration 27's audit
-- note: sale_items already has exactly one RLS policy (SELECT-only), no
-- INSERT/UPDATE/DELETE policy exists on it at all.

create or replace view sale_items_secure as
select
  id,
  sale_id,
  product_id,
  product_name,
  barcode,
  quantity,
  unit_price,
  total_price,
  unit_label,
  unit_conversion_factor,
  case
    when exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      then cost_price
    else null
  end as cost_price,
  store_id
from sale_items;

revoke select on sale_items from authenticated;
grant select on sale_items_secure to authenticated;
