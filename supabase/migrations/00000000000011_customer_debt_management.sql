-- Customer Debt Management (بيع بالآجل).
--
-- Two new tables following the existing append-only-ledger pattern (see
-- returns, stock_damages, held_sales) — balance is a VIEW computed from
-- customer_transactions, never a stored mutable column, so a skipped write
-- can't desync it from reality.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  credit_limit numeric(12, 2) not null default 0 check (credit_limit >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists customers_name_idx on customers (name);

create table if not exists customer_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  type text not null check (type in ('sale', 'payment')),
  amount numeric(12, 2) not null check (amount > 0),
  sale_id uuid references sales (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists customer_transactions_customer_id_idx on customer_transactions (customer_id);
create index if not exists customer_transactions_created_at_idx on customer_transactions (created_at);

create or replace view customer_balances as
select
  customer_id,
  coalesce(sum(case when type = 'sale' then amount else -amount end), 0) as balance
from customer_transactions
group by customer_id;

-- sales: add credit-sale support.
alter table sales drop constraint if exists sales_payment_method_check;
alter table sales add constraint sales_payment_method_check check (payment_method in ('cash', 'credit'));
alter table sales add column if not exists customer_id uuid references customers (id) on delete set null;

create index if not exists sales_customer_id_idx on sales (customer_id);

-- operations_log: extend both check constraints for customer actions.
--
-- The action_type list below is the REAL current full list as of migration
-- 00000000000004 ('sale_created' ... 'stock_adjusted') PLUS 'stock_received',
-- 'return_created', 'damage_recorded' — which types/database.types.ts's
-- OperationActionType union already includes and services/*.ts already
-- write, but which no prior migration's CHECK constraint was ever updated
-- to allow (a pre-existing gap, not introduced by this migration) — plus
-- the four new customer_* action types this feature adds.
alter table operations_log drop constraint if exists operations_log_action_type_check;
alter table operations_log add constraint operations_log_action_type_check check (
  action_type in (
    'sale_created',
    'product_created', 'product_updated', 'product_deleted',
    'category_created', 'category_updated', 'category_deleted',
    'stock_adjusted', 'stock_received',
    'return_created', 'damage_recorded',
    'customer_created', 'customer_updated', 'customer_archived', 'customer_payment_recorded'
  )
);
alter table operations_log drop constraint if exists operations_log_entity_type_check;
alter table operations_log add constraint operations_log_entity_type_check check (
  entity_type in ('product', 'category', 'sale', 'stock', 'customer')
);

alter table customers enable row level security;
alter table customer_transactions enable row level security;

create policy "authenticated all customers" on customers for all to authenticated using (true) with check (true);
create policy "authenticated all customer_transactions" on customer_transactions for all to authenticated using (true) with check (true);
