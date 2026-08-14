-- Store contact info (phone/address) + admin-only self-service edit.
--
-- Adds the two nullable columns and the store's own admin's ability to
-- edit name/phone/address (never slug/is_active — those stay writable
-- only via delivery-next's service-role client). See
-- 00000000000013_stores_rls_and_subscription_gate.sql for why stores had
-- zero write policies until now.

alter table stores add column phone text;
alter table stores add column address text;

create policy "store admin update own store" on stores for update to authenticated
  using (
    id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    id = current_store_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Column-level grant: even though the policy above lets an admin's UPDATE
-- statement target the stores row, Postgres also requires column-level
-- privilege on every column referenced by the UPDATE — restrict that to
-- name/phone/address only so slug/is_active can never be changed through
-- this path, policy notwithstanding.
grant update (name, phone, address) on stores to authenticated;
