-- Admin-only suppliers/supplier_transactions/supplier_products, plus a
-- cashier-bypass guard on stock_purchases — fixes audit item
-- (mashee_mart_security_audit.md, 🟡, "جداول الموردين قابلة للقراءة
-- والكتابة من أي كاشير رغم أن الواجهة تخصّصها للمالك فقط").
--
-- suppliers/supplier_transactions/supplier_products: all UI for these three
-- tables lives under app/(dashboard)/suppliers/page.tsx, gated
-- `if (!isAdmin)` with an explicit "هذي الصفحة للمالك فقط" message, and is
-- adminOnly: true in components/shared/navLinks.ts. Grepped every
-- .from("suppliers"|"supplier_transactions"|"supplier_products") and every
-- services/suppliers.service.ts caller across app/, components/, hooks/:
-- the only caller outside components/features/suppliers/* is the
-- supplier-picker inside components/features/inventory/ReceiveStockForm.tsx,
-- itself gated `if (!isAdmin) return;` before calling listSuppliers. No
-- legitimate cashier-facing flow reads or writes any of these three tables.
-- Full admin-only lockdown (SELECT/INSERT/UPDATE/DELETE), same inline
-- admin-check pattern as migrations 23/28/30 — no cashier access of any
-- kind survives.
--
-- stock_purchases: NOT locked down the same way. This table has a genuine
-- cashier-facing write path: services/products.service.ts#recordStockPurchase
-- (called from ReceiveStockForm.tsx, reachable by ANY authenticated user —
-- "a cashier sees only quantity/cost, unchanged from before") ALWAYS inserts
-- a stock_purchases row regardless of role, with supplier_id/payment_method
-- forced to null for non-admins (isAdmin && supplierId ? supplierId : null
-- in ReceiveStockForm.tsx, mirrored by params.supplierId ?? null in
-- recordStockPurchase itself). SELECT and the general INSERT-ability stay
-- open to any same-store authenticated user. The gap closed here is
-- secondary to the one named in the audit text: nothing today stops a
-- cashier from bypassing the UI and crafting a direct REST insert with a
-- fabricated supplier_id/payment_method. Fix: add a with check condition
-- requiring supplier_id is null OR caller is admin. payment_method needs no
-- separate guard — the pre-existing table CHECK constraint
-- (stock_purchases_payment_method_requires_supplier, migration 17) already
-- makes payment_method NOT NULL only possible when supplier_id IS NOT NULL,
-- so blocking non-admin supplier_id transitively blocks non-admin
-- payment_method too.
--
-- supplier_balances (VIEW, migration 16): no change needed. It is a plain
-- view (`create or replace view ... as select ...`), not SECURITY DEFINER —
-- confirmed live via pg_views/pg_class, reloptions is null (no
-- security_invoker/security_barrier set, and none needed). Postgres's
-- default view behavior already means it runs with the querying role's own
-- privileges over the underlying tables, so once suppliers/
-- supplier_transactions go admin-only, supplier_balances automatically
-- returns nothing to a non-admin and continues to work unchanged for
-- admins. No migration changes to the view.

-- suppliers ------------------------------------------------------------
drop policy if exists "authenticated read suppliers" on suppliers;
drop policy if exists "authenticated insert suppliers" on suppliers;
drop policy if exists "authenticated update suppliers" on suppliers;

create policy "admin read suppliers" on suppliers for select to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin insert suppliers" on suppliers for insert to authenticated
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin update suppliers" on suppliers for update to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- supplier_transactions --------------------------------------------------
drop policy if exists "authenticated read supplier_transactions" on supplier_transactions;
drop policy if exists "authenticated insert supplier_transactions" on supplier_transactions;

create policy "admin read supplier_transactions" on supplier_transactions for select to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin insert supplier_transactions" on supplier_transactions for insert to authenticated
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- supplier_products --------------------------------------------------------
drop policy if exists "authenticated read supplier_products" on supplier_products;
drop policy if exists "authenticated insert supplier_products" on supplier_products;
drop policy if exists "authenticated update supplier_products" on supplier_products;
drop policy if exists "authenticated delete supplier_products" on supplier_products;

create policy "admin read supplier_products" on supplier_products for select to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin insert supplier_products" on supplier_products for insert to authenticated
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin update supplier_products" on supplier_products for update to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin delete supplier_products" on supplier_products for delete to authenticated
  using (
    store_id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- stock_purchases: leave SELECT and the general INSERT-ability untouched,
-- add a supplier_id guard to the existing INSERT policy's with check ------
drop policy if exists "authenticated insert stock_purchases" on stock_purchases;

create policy "authenticated insert stock_purchases" on stock_purchases for insert to authenticated
  with check (
    store_id = current_store_id()
    and (
      supplier_id is null
      or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    )
  );
