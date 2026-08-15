-- Cash Drawer / Shift Management (إدارة الورديات / درج النقدية).
--
-- A shift wraps a cashier's work session: opening balance -> active
-- selling -> closing count -> computed shortage/surplus. Sales, customer
-- debt payments, and cash refunds are NOT linked to a shift by a foreign
-- key -- they're attributed by cashier_id + falling inside
-- [opened_at, closed_at) at report/close time, the same convention this
-- repo already uses for stock_damages/stock_reconciliations/returns
-- reporting. See
-- docs/superpowers/specs/2026-08-15-cash-drawer-shift-management-design.md
-- for the full design and rationale.
create table shifts (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid references profiles (id) on delete set null,
  store_id uuid not null references stores (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_balance numeric(12, 2) not null check (opening_balance >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  expected_amount numeric(12, 2),
  counted_amount numeric(12, 2),
  difference numeric(12, 2),
  forced_closed_by uuid references profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

-- A cashier can only ever have one open shift at a time.
create unique index shifts_one_open_per_cashier
  on shifts (cashier_id) where status = 'open';

create index shifts_store_id_idx on shifts (store_id);
create index shifts_cashier_id_idx on shifts (cashier_id);
create index shifts_opened_at_idx on shifts (opened_at);

alter table shifts enable row level security;

create policy "authenticated read shifts" on shifts for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert own shift" on shifts for insert to authenticated
  with check (store_id = current_store_id() and cashier_id = auth.uid());

create policy "close own shift or admin force-close" on shifts for update to authenticated
  using (
    store_id = current_store_id()
    and (
      cashier_id = auth.uid()
      or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    )
  )
  with check (store_id = current_store_id());

-- customer_transactions had no actor column at all before this --
-- recordPayment only logged the actor to operations_log. Needed so cash
-- debt payments can be attributed to the cashier's shift for drawer
-- reconciliation.
alter table customer_transactions add column cashier_id uuid references profiles (id) on delete set null;
create index customer_transactions_cashier_id_idx on customer_transactions (cashier_id);
