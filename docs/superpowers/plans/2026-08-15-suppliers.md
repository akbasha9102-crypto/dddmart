# Suppliers (الموردون) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a suppliers subsystem to dddmart — a suppliers table, a many-to-many product↔supplier link (with an optional per-supplier cost), and a manual account ledger (purchases/payments) with an automatically computed balance, surfaced in a new admin-only `/suppliers` page.

**Architecture:** Mirrors the existing `customers` feature exactly: an append-only `supplier_transactions` ledger + a `supplier_balances` view (never a stored balance column) for financial integrity, a `services/suppliers.service.ts` following this repo's plain-function-taking-a-Supabase-client convention, and a `components/features/suppliers/` folder mirroring `components/features/customers/`'s List/Form/Detail split. New here (customers has no equivalent): a `supplier_products` join table and a per-supplier `opening_balance` column seeding the balance view.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (`@supabase/supabase-js`), Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-suppliers-design.md`

## Global Constraints

- All UI copy is Arabic, RTL-appropriate, matching the exact phrasing/tone of the existing customers/employees screens referenced throughout this plan.
- Currency and dates go through `lib/utils.ts`'s existing `formatCurrency`/`formatDateTime` — never format manually.
- Every new table has `store_id uuid not null references stores (id)`; every RLS policy checks `store_id = current_store_id()` (select/insert/update as applicable) — no DB-level role check (this repo has none anywhere).
- Admin-only enforcement is a client-side `role === "admin"` check in the page component (mirrors `app/(dashboard)/employees/page.tsx`), never an RLS role check.
- `supplier_transactions` is append-only: select + insert RLS policies only, no update/delete — a purchase or payment is corrected by a new entry, never edited.
- `types/database.types.ts` is hand-authored (not generated) — every migration change needs a matching manual edit there.
- No changes to `services/products.service.ts`, `components/features/inventory/**`, or the stock-receiving flow — explicitly out of scope per the spec.
- Test commands: `npm run typecheck && npm run lint && npm run test && npm run build` — all must pass before each task's commit.
- Do not apply the migration to the live Supabase project and do not push to `origin/main` as part of this plan — both require the user's own explicit confirmation afterward, per this project's established convention.

---

### Task 1: Database schema — migration + hand-authored types

**Files:**
- Create: `supabase/migrations/00000000000016_suppliers.sql`
- Modify: `types/database.types.ts`

**Interfaces:**
- Produces: `suppliers`, `supplier_transactions`, `supplier_products` tables and the `supplier_balances` view (all consumed by every later task); `OperationActionType` gains `"supplier_created" | "supplier_updated" | "supplier_archived" | "supplier_purchase_recorded" | "supplier_payment_recorded"`; `OperationEntityType` gains `"supplier"`; new exported type `SupplierTransactionType = "purchase" | "payment"`.

- [ ] **Step 1: Write the migration file**

```sql
-- Suppliers (الموردون).
--
-- suppliers: one row per supplier, with an opening_balance seeding the
-- balance computation below (existing debt from before the system was
-- used — plain editable supplier data, not a locked ledger entry).
--
-- supplier_transactions: append-only ledger (no update/delete policy,
-- same convention as customer_transactions/stock_reconciliations) — a
-- 'purchase' increases what the merchant owes the supplier, a 'payment'
-- decreases it. Corrected only by a new entry, never edited.
--
-- supplier_products: many-to-many link between suppliers and products
-- (a product can have more than one supplier). cost_price is nullable —
-- when unset, the UI falls back to the product's own cost_price. Pure
-- mapping data (not financial history), so it cascade-deletes and is
-- not itself audit-logged.
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  note text,
  opening_balance numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index suppliers_store_id_idx on suppliers (store_id);
create index suppliers_name_idx on suppliers (name);

alter table suppliers enable row level security;

create policy "authenticated read suppliers" on suppliers for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert suppliers" on suppliers for insert to authenticated
  with check (store_id = current_store_id());

create policy "authenticated update suppliers" on suppliers for update to authenticated
  using (store_id = current_store_id())
  with check (store_id = current_store_id());

create table supplier_transactions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id) on delete cascade,
  type text not null check (type in ('purchase', 'payment')),
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);

create index supplier_transactions_supplier_id_idx on supplier_transactions (supplier_id);
create index supplier_transactions_store_id_idx on supplier_transactions (store_id);
create index supplier_transactions_created_at_idx on supplier_transactions (created_at);

alter table supplier_transactions enable row level security;

create policy "authenticated read supplier_transactions" on supplier_transactions for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert supplier_transactions" on supplier_transactions for insert to authenticated
  with check (store_id = current_store_id());

create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  cost_price numeric(12, 2),
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now(),
  unique (supplier_id, product_id)
);

create index supplier_products_supplier_id_idx on supplier_products (supplier_id);
create index supplier_products_product_id_idx on supplier_products (product_id);
create index supplier_products_store_id_idx on supplier_products (store_id);

alter table supplier_products enable row level security;

create policy "authenticated read supplier_products" on supplier_products for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert supplier_products" on supplier_products for insert to authenticated
  with check (store_id = current_store_id());

create policy "authenticated update supplier_products" on supplier_products for update to authenticated
  using (store_id = current_store_id())
  with check (store_id = current_store_id());

create policy "authenticated delete supplier_products" on supplier_products for delete to authenticated
  using (store_id = current_store_id());

-- Balance is computed, never stored (same reasoning as customer_balances,
-- migration 00000000000011) — a skipped or double write to a mutable
-- column could silently desync it from reality. Starts from suppliers
-- (left join, not an inner group-by on supplier_transactions) so every
-- supplier has exactly one balance row even with zero transactions,
-- since opening_balance can already be non-zero on day one.
create or replace view supplier_balances as
select
  s.id as supplier_id,
  s.opening_balance
    + coalesce(sum(case when st.type = 'purchase' then st.amount else -st.amount end), 0)
    as balance
from suppliers s
left join supplier_transactions st on st.supplier_id = s.id
group by s.id, s.opening_balance;
```

- [ ] **Step 2: Add `SupplierTransactionType` and extend the audit-log unions**

In `types/database.types.ts`, find this block near the top of the file (around line 9-27):

```ts
export type OperationActionType =
  | "sale_created"
  | "product_created"
  | "product_updated"
  | "product_deleted"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "stock_adjusted"
  | "stock_received"
  | "return_created"
  | "damage_recorded"
  | "stock_reconciled"
  | "customer_created"
  | "customer_updated"
  | "customer_archived"
  | "customer_payment_recorded";
export type OperationEntityType = "product" | "category" | "sale" | "stock" | "customer";
export type CustomerTransactionType = "sale" | "payment";
```

Replace it with:

```ts
export type OperationActionType =
  | "sale_created"
  | "product_created"
  | "product_updated"
  | "product_deleted"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "stock_adjusted"
  | "stock_received"
  | "return_created"
  | "damage_recorded"
  | "stock_reconciled"
  | "customer_created"
  | "customer_updated"
  | "customer_archived"
  | "customer_payment_recorded"
  | "supplier_created"
  | "supplier_updated"
  | "supplier_archived"
  | "supplier_purchase_recorded"
  | "supplier_payment_recorded";
export type OperationEntityType = "product" | "category" | "sale" | "stock" | "customer" | "supplier";
export type CustomerTransactionType = "sale" | "payment";
export type SupplierTransactionType = "purchase" | "payment";
```

- [ ] **Step 3: Add the three `Tables` entries**

In `types/database.types.ts`, find the `customer_transactions` table block (around line 621-668) and insert the following three new table entries immediately after its closing `};` (i.e. right before the `operations_log:` entry that currently follows it):

```ts
      suppliers: {
        Row: {
          id: string;
          name: string;
          phone: string | null;
          address: string | null;
          note: string | null;
          opening_balance: number;
          is_active: boolean;
          store_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone?: string | null;
          address?: string | null;
          note?: string | null;
          opening_balance?: number;
          is_active?: boolean;
          store_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string | null;
          address?: string | null;
          note?: string | null;
          opening_balance?: number;
          is_active?: boolean;
          store_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      supplier_transactions: {
        Row: {
          id: string;
          supplier_id: string;
          type: SupplierTransactionType;
          amount: number;
          note: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          supplier_id: string;
          type: SupplierTransactionType;
          amount: number;
          note?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          supplier_id?: string;
          type?: SupplierTransactionType;
          amount?: number;
          note?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_transactions_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_products: {
        Row: {
          id: string;
          supplier_id: string;
          product_id: string;
          cost_price: number | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          supplier_id: string;
          product_id: string;
          cost_price?: number | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          supplier_id?: string;
          product_id?: string;
          cost_price?: number | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_products_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_products_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 4: Add the `supplier_balances` view entry**

In the same file, find the `Views` block (around line 714-722):

```ts
    Views: {
      customer_balances: {
        Row: {
          customer_id: string;
          balance: number;
        };
        Relationships: [];
      };
    };
```

Replace it with:

```ts
    Views: {
      customer_balances: {
        Row: {
          customer_id: string;
          balance: number;
        };
        Relationships: [];
      };
      supplier_balances: {
        Row: {
          supplier_id: string;
          balance: number;
        };
        Relationships: [];
      };
    };
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no code references the new tables yet, so this only confirms the hand-authored types themselves are syntactically valid TypeScript).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00000000000016_suppliers.sql types/database.types.ts
git commit -m "feat: add suppliers database schema"
```

---

### Task 2: `types/supplier.ts` + supplier CRUD service

**Files:**
- Create: `types/supplier.ts`
- Create: `services/suppliers.service.ts`
- Create: `services/suppliers.service.test.ts`

**Interfaces:**
- Consumes: `Database["public"]["Tables"]["suppliers"]["Row"|"Insert"|"Update"]`, `Database["public"]["Views"]["supplier_balances"]["Row"]` (Task 1).
- Produces: `Supplier`, `SupplierUpdate`, `SupplierWithBalance` types; `listSuppliers(supabase, options?): Promise<SupplierWithBalance[]>`; `createSupplier(supabase, input, actorId, storeId): Promise<Supplier>`; `updateSupplier(supabase, id, patch, actorId, storeId): Promise<Supplier>`; `archiveSupplier(supabase, id, actorId, storeId): Promise<void>`; `getSupplierBalance(supabase, supplierId): Promise<number>` — all consumed by later tasks and by the UI tasks.

- [ ] **Step 1: Create `types/supplier.ts`**

```ts
import type { Database } from "./database.types";

export type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];
export type SupplierInsert = Database["public"]["Tables"]["suppliers"]["Insert"];
export type SupplierUpdate = Database["public"]["Tables"]["suppliers"]["Update"];

export type SupplierTransaction = Database["public"]["Tables"]["supplier_transactions"]["Row"];
export type SupplierTransactionInsert = Database["public"]["Tables"]["supplier_transactions"]["Insert"];

export type SupplierProduct = Database["public"]["Tables"]["supplier_products"]["Row"];
export type SupplierProductInsert = Database["public"]["Tables"]["supplier_products"]["Insert"];

export type SupplierBalance = Database["public"]["Views"]["supplier_balances"]["Row"];

export interface SupplierWithBalance extends Supplier {
  balance: number;
}
```

- [ ] **Step 2: Write the failing tests for `getSupplierBalance` and `createSupplier`**

Create `services/suppliers.service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupplierBalance, createSupplier } from "./suppliers.service";
import type { Database } from "@/types/database.types";
import type { Supplier } from "@/types/supplier";

const INSERTED_SUPPLIER: Supplier = {
  id: "supplier-1",
  name: "شركة الفرات",
  phone: null,
  address: null,
  note: null,
  opening_balance: 0,
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

function createFakeSupabase(options: { balance: number | null; insertedSupplier: Supplier }): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedSupplier, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "supplier_balances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.balance === null ? null : { supplier_id: "supplier-1", balance: options.balance },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "suppliers") {
        return { insert: insertSpy };
      }
      if (table === "operations_log") {
        return { insert: logInsertSpy };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, insertSpy, logInsertSpy };
}

describe("getSupplierBalance", () => {
  it("returns 0 when the view has no row for that supplier", async () => {
    const { supabase } = createFakeSupabase({ balance: null, insertedSupplier: INSERTED_SUPPLIER });

    const result = await getSupplierBalance(supabase, "supplier-1");

    expect(result).toBe(0);
  });

  it("returns the view's balance (including a non-zero opening balance already folded in)", async () => {
    const { supabase } = createFakeSupabase({ balance: 15000, insertedSupplier: INSERTED_SUPPLIER });

    const result = await getSupplierBalance(supabase, "supplier-1");

    expect(result).toBe(15000);
  });
});

describe("createSupplier", () => {
  it("rejects an empty name", async () => {
    const { supabase } = createFakeSupabase({ balance: 0, insertedSupplier: INSERTED_SUPPLIER });

    await expect(createSupplier(supabase, { name: "   " }, "user-1", "store-1")).rejects.toThrow("اسم المورد مطلوب");
  });

  it("inserts a supplier with a default opening_balance of 0 and logs supplier_created", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabase({
      balance: 0,
      insertedSupplier: INSERTED_SUPPLIER,
    });

    const result = await createSupplier(supabase, { name: "شركة الفرات" }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith({
      name: "شركة الفرات",
      phone: null,
      address: null,
      note: null,
      opening_balance: 0,
      store_id: "store-1",
    });
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "supplier_created" }));
    expect(result).toEqual(INSERTED_SUPPLIER);
  });

  it("passes through a non-zero opening_balance", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ balance: 0, insertedSupplier: INSERTED_SUPPLIER });

    await createSupplier(supabase, { name: "شركة الفرات", openingBalance: 25000 }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ opening_balance: 25000 }));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- suppliers.service`
Expected: FAIL — `services/suppliers.service.ts` does not exist yet.

- [ ] **Step 4: Implement `services/suppliers.service.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Supplier, SupplierUpdate, SupplierWithBalance } from "@/types/supplier";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/** Reads the supplier_balances view (a VIEW seeded from suppliers.opening_balance and folded with supplier_transactions — never a stored column, see migration 00000000000016). 0 when the supplier row itself can't be found. */
export async function getSupplierBalance(supabase: Client, supplierId: string): Promise<number> {
  const { data, error } = await supabase
    .from("supplier_balances")
    .select("balance")
    .eq("supplier_id", supplierId)
    .maybeSingle();

  if (error) throw error;
  return data?.balance ?? 0;
}

export interface ListSuppliersOptions {
  search?: string;
}

/** Active suppliers, ordered by name, each joined with its live balance. */
export async function listSuppliers(supabase: Client, options?: ListSuppliersOptions): Promise<SupplierWithBalance[]> {
  let query = supabase.from("suppliers").select("*").eq("is_active", true).order("name");

  const term = options?.search?.trim();
  if (term) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data: suppliers, error } = await query;
  if (error) throw error;

  const rows = suppliers ?? [];
  if (rows.length === 0) return [];

  const { data: balances, error: balancesError } = await supabase
    .from("supplier_balances")
    .select("supplier_id, balance")
    .in(
      "supplier_id",
      rows.map((row) => row.id),
    );
  if (balancesError) throw balancesError;

  const balanceBySupplierId = new Map<string, number>();
  (balances ?? []).forEach((row) => balanceBySupplierId.set(row.supplier_id, row.balance));

  return rows.map((row) => ({ ...row, balance: balanceBySupplierId.get(row.id) ?? 0 }));
}

export interface CreateSupplierInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  openingBalance?: number;
}

export async function createSupplier(
  supabase: Client,
  input: CreateSupplierInput,
  actorId: string | null,
  storeId: string,
): Promise<Supplier> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("اسم المورد مطلوب");
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: trimmedName,
      phone: input.phone ?? null,
      address: input.address ?? null,
      note: input.note ?? null,
      opening_balance: input.openingBalance ?? 0,
      store_id: storeId,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_created",
    entityType: "supplier",
    entityId: data.id,
    description: `تم إضافة المورد "${data.name}"`,
    storeId,
  });

  return data;
}

export async function updateSupplier(
  supabase: Client,
  id: string,
  patch: SupplierUpdate,
  actorId: string | null,
  storeId: string,
): Promise<Supplier> {
  const { data, error } = await supabase.from("suppliers").update(patch).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_updated",
    entityType: "supplier",
    entityId: data.id,
    description: `تم تعديل بيانات المورد "${data.name}"`,
    storeId,
  });

  return data;
}

/** Soft delete: sets is_active = false so the supplier disappears from active listings while preserving its ledger history/FKs. */
export async function archiveSupplier(supabase: Client, id: string, actorId: string | null, storeId: string): Promise<void> {
  const { data, error } = await supabase.from("suppliers").update({ is_active: false }).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_archived",
    entityType: "supplier",
    entityId: data.id,
    description: `تم أرشفة المورد "${data.name}"`,
    storeId,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- suppliers.service`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add types/supplier.ts services/suppliers.service.ts services/suppliers.service.test.ts
git commit -m "feat: add supplier types and CRUD service"
```

---

### Task 3: Supplier ledger — purchase/payment recording

**Files:**
- Modify: `services/suppliers.service.ts` (append)
- Modify: `services/suppliers.service.test.ts` (append)

**Interfaces:**
- Consumes: `getSupplierBalance` (Task 2, same file), `logOperation` (already imported).
- Produces: `recordSupplierPurchase(supabase, input, actorId, storeId): Promise<SupplierTransaction>`; `recordSupplierPayment(supabase, input, actorId, storeId): Promise<SupplierTransaction>` — both consumed by `SupplierDetail.tsx` (Task 6).

- [ ] **Step 1: Write the failing tests**

Append to `services/suppliers.service.test.ts` (add the import of `SupplierTransaction` alongside the existing `Supplier` import, and add `recordSupplierPurchase, recordSupplierPayment` to the existing import from `"./suppliers.service"`):

```ts
import type { SupplierTransaction } from "@/types/supplier";
```

```ts
const INSERTED_TRANSACTION: SupplierTransaction = {
  id: "txn-1",
  supplier_id: "supplier-1",
  type: "payment",
  amount: 5000,
  note: null,
  store_id: "store-1",
  created_at: "",
};

function createFakeSupabaseForLedger(options: { balance: number | null; insertedTransaction: SupplierTransaction }): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedTransaction, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "supplier_balances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.balance === null ? null : { supplier_id: "supplier-1", balance: options.balance },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "supplier_transactions") {
        return { insert: insertSpy };
      }
      if (table === "operations_log") {
        return { insert: logInsertSpy };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, insertSpy, logInsertSpy };
}

describe("recordSupplierPurchase", () => {
  it("rejects an amount of zero or less", async () => {
    const { supabase } = createFakeSupabaseForLedger({ balance: 0, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordSupplierPurchase(supabase, { supplierId: "supplier-1", amount: 0 }, "user-1", "store-1"),
    ).rejects.toThrow("أكبر من صفر");
  });

  it("inserts a purchase transaction and logs supplier_purchase_recorded", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabaseForLedger({
      balance: 0,
      insertedTransaction: { ...INSERTED_TRANSACTION, type: "purchase", amount: 12000 },
    });

    await recordSupplierPurchase(supabase, { supplierId: "supplier-1", amount: 12000 }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith({
      supplier_id: "supplier-1",
      type: "purchase",
      amount: 12000,
      note: null,
      store_id: "store-1",
    });
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "supplier_purchase_recorded" }));
  });
});

describe("recordSupplierPayment", () => {
  it("rejects an amount of zero or less", async () => {
    const { supabase } = createFakeSupabaseForLedger({ balance: 10000, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordSupplierPayment(supabase, { supplierId: "supplier-1", amount: 0 }, "user-1", "store-1"),
    ).rejects.toThrow("أكبر من صفر");
  });

  it("rejects an amount greater than the current balance, and includes the actual remaining balance in the error", async () => {
    const { supabase } = createFakeSupabaseForLedger({ balance: 3000, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordSupplierPayment(supabase, { supplierId: "supplier-1", amount: 5000 }, "user-1", "store-1"),
    ).rejects.toThrow("المستحق: 3000");
  });

  it("inserts a payment transaction and logs supplier_payment_recorded on the happy path", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabaseForLedger({
      balance: 10000,
      insertedTransaction: INSERTED_TRANSACTION,
    });

    const result = await recordSupplierPayment(supabase, { supplierId: "supplier-1", amount: 5000 }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith({
      supplier_id: "supplier-1",
      type: "payment",
      amount: 5000,
      note: null,
      store_id: "store-1",
    });
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "supplier_payment_recorded" }));
    expect(result).toEqual(INSERTED_TRANSACTION);
  });
});
```

Also update the top-level import line that currently reads:

```ts
import { getSupplierBalance, createSupplier } from "./suppliers.service";
```

to:

```ts
import { getSupplierBalance, createSupplier, recordSupplierPurchase, recordSupplierPayment } from "./suppliers.service";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- suppliers.service`
Expected: FAIL — `recordSupplierPurchase`/`recordSupplierPayment` are not exported yet.

- [ ] **Step 3: Implement the ledger functions**

Append to `services/suppliers.service.ts`:

```ts
import type { SupplierTransaction } from "@/types/supplier";
```

(add `SupplierTransaction` to the existing `import type { Supplier, SupplierUpdate, SupplierWithBalance } from "@/types/supplier";` line instead of a separate import statement)

```ts
export interface RecordSupplierPurchaseInput {
  supplierId: string;
  amount: number;
  note?: string | null;
}

/** Records a purchase invoice against a supplier's balance — increases what the merchant owes them. Entered manually; not wired to the inventory-receiving flow (see the spec's "out of scope" note). */
export async function recordSupplierPurchase(
  supabase: Client,
  input: RecordSupplierPurchaseInput,
  actorId: string | null,
  storeId: string,
): Promise<SupplierTransaction> {
  if (input.amount <= 0) {
    throw new Error("مبلغ الفاتورة يجب أن يكون أكبر من صفر");
  }

  const { data, error } = await supabase
    .from("supplier_transactions")
    .insert({
      supplier_id: input.supplierId,
      type: "purchase",
      amount: input.amount,
      note: input.note ?? null,
      store_id: storeId,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_purchase_recorded",
    entityType: "supplier",
    entityId: input.supplierId,
    description: `تم تسجيل فاتورة شراء بقيمة ${input.amount} من المورد`,
    storeId,
  });

  return data;
}

export interface RecordSupplierPaymentInput {
  supplierId: string;
  amount: number;
  note?: string | null;
}

/**
 * Records a payment to a supplier, reducing the balance owed. Partial
 * payments under the current balance are fine; overpaying past the
 * balance is rejected (Arabic error shows the actual remaining balance)
 * — same cap customers.service.ts#recordPayment uses.
 */
export async function recordSupplierPayment(
  supabase: Client,
  input: RecordSupplierPaymentInput,
  actorId: string | null,
  storeId: string,
): Promise<SupplierTransaction> {
  if (input.amount <= 0) {
    throw new Error("مبلغ الدفعة يجب أن يكون أكبر من صفر");
  }

  const currentBalance = await getSupplierBalance(supabase, input.supplierId);
  if (input.amount > currentBalance) {
    throw new Error(`مبلغ الدفعة أكبر من الرصيد المستحق (المستحق: ${currentBalance})`);
  }

  const { data, error } = await supabase
    .from("supplier_transactions")
    .insert({
      supplier_id: input.supplierId,
      type: "payment",
      amount: input.amount,
      note: input.note ?? null,
      store_id: storeId,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_payment_recorded",
    entityType: "supplier",
    entityId: input.supplierId,
    description: `تم تسجيل دفعة بقيمة ${input.amount} للمورد`,
    storeId,
  });

  return data;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- suppliers.service`
Expected: PASS (all previous tests plus the 5 new ones)

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/suppliers.service.ts services/suppliers.service.test.ts
git commit -m "feat: add supplier purchase/payment ledger recording"
```

---

### Task 4: Supplier↔product linking

**Files:**
- Modify: `services/suppliers.service.ts` (append)
- Modify: `services/suppliers.service.test.ts` (append)
- Modify: `types/supplier.ts` (append)

**Interfaces:**
- Consumes: `Supplier` (Task 2), `Database["public"]["Tables"]["supplier_products"]["Row"]` (Task 1), `Product` type from `@/types/product` (existing).
- Produces: `SupplierProductWithDetails` type; `getSupplier(supabase, id): Promise<SupplierDetailData>`; `getSupplierProducts(supabase, supplierId): Promise<SupplierProductWithDetails[]>`; `linkSupplierProduct(supabase, input, storeId): Promise<SupplierProduct>`; `unlinkSupplierProduct(supabase, supplierId, productId): Promise<void>` — all consumed by `SupplierDetail.tsx`/`SupplierProductPicker.tsx` (Tasks 6-7).

- [ ] **Step 1: Confirm the existing `Product` type import path**

Run: `grep -n "^export type Product" types/product.ts`
Expected: a line like `export type Product = Database["public"]["Tables"]["products"]["Row"];` — confirms `import type { Product } from "@/types/product";` is correct for the next step. (If the export is named differently, use that name instead throughout this task.)

- [ ] **Step 2: Add `SupplierProductWithDetails` to `types/supplier.ts`**

Append to `types/supplier.ts`:

```ts
import type { Product } from "./product";

export interface SupplierProductWithDetails extends SupplierProduct {
  product: Product;
}
```

- [ ] **Step 3: Write the failing tests**

Append to `services/suppliers.service.test.ts` (update the `"./suppliers.service"` import to add `linkSupplierProduct, unlinkSupplierProduct, getSupplierProducts`, and add `import type { SupplierProduct } from "@/types/supplier";`):

```ts
describe("linkSupplierProduct", () => {
  it("upserts on (supplier_id, product_id) so re-linking updates cost instead of erroring", async () => {
    const upsertedRow: SupplierProduct = {
      id: "link-1",
      supplier_id: "supplier-1",
      product_id: "product-1",
      cost_price: 1500,
      store_id: "store-1",
      created_at: "",
    };
    const upsertSpy = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: upsertedRow, error: null }),
      }),
    }));
    const supabase = {
      from: (table: string) => {
        if (table === "supplier_products") return { upsert: upsertSpy };
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    const result = await linkSupplierProduct(supabase, { supplierId: "supplier-1", productId: "product-1", costPrice: 1500 }, "store-1");

    expect(upsertSpy).toHaveBeenCalledWith(
      { supplier_id: "supplier-1", product_id: "product-1", cost_price: 1500, store_id: "store-1" },
      { onConflict: "supplier_id,product_id" },
    );
    expect(result).toEqual(upsertedRow);
  });
});

describe("unlinkSupplierProduct", () => {
  it("deletes the join row for the given supplier/product pair", async () => {
    const eqSecondSpy = vi.fn(async () => ({ error: null }));
    const eqFirstSpy = vi.fn(() => ({ eq: eqSecondSpy }));
    const deleteSpy = vi.fn(() => ({ eq: eqFirstSpy }));
    const supabase = {
      from: (table: string) => {
        if (table === "supplier_products") return { delete: deleteSpy };
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    await unlinkSupplierProduct(supabase, "supplier-1", "product-1");

    expect(deleteSpy).toHaveBeenCalled();
    expect(eqFirstSpy).toHaveBeenCalledWith("supplier_id", "supplier-1");
    expect(eqSecondSpy).toHaveBeenCalledWith("product_id", "product-1");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test -- suppliers.service`
Expected: FAIL — `linkSupplierProduct`/`unlinkSupplierProduct` are not exported yet.

- [ ] **Step 5: Implement the linking functions and `getSupplier` detail read**

Append to `services/suppliers.service.ts` (and add `SupplierProduct, SupplierProductWithDetails` to the existing `import type { ... } from "@/types/supplier";` line):

```ts
/** Products linked to one supplier, newest link first, each joined with its full product row. */
export async function getSupplierProducts(supabase: Client, supplierId: string): Promise<SupplierProductWithDetails[]> {
  const { data, error } = await supabase
    .from("supplier_products")
    .select("*, product:products(*)")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SupplierProductWithDetails[];
}

export interface LinkSupplierProductInput {
  supplierId: string;
  productId: string;
  costPrice?: number | null;
}

/** Links a product to a supplier, or updates the cost_price if the pair is already linked (upsert on the (supplier_id, product_id) unique constraint). Not audit-logged — routine configuration, not a financial event. */
export async function linkSupplierProduct(
  supabase: Client,
  input: LinkSupplierProductInput,
  storeId: string,
): Promise<SupplierProduct> {
  const { data, error } = await supabase
    .from("supplier_products")
    .upsert(
      {
        supplier_id: input.supplierId,
        product_id: input.productId,
        cost_price: input.costPrice ?? null,
        store_id: storeId,
      },
      { onConflict: "supplier_id,product_id" },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Removes a supplier↔product link. Not audit-logged, same reasoning as linkSupplierProduct. */
export async function unlinkSupplierProduct(supabase: Client, supplierId: string, productId: string): Promise<void> {
  const { error } = await supabase.from("supplier_products").delete().eq("supplier_id", supplierId).eq("product_id", productId);

  if (error) throw error;
}

export interface SupplierDetailData {
  supplier: Supplier;
  balance: number;
  transactions: SupplierTransaction[];
  products: SupplierProductWithDetails[];
}

/** Full detail for the supplier-detail screen: the supplier row, its live balance, its transaction history (newest first), and its linked products. */
export async function getSupplier(supabase: Client, id: string): Promise<SupplierDetailData> {
  const { data: supplier, error } = await supabase.from("suppliers").select("*").eq("id", id).single();
  if (error) throw error;

  const [balance, transactionsResult, products] = await Promise.all([
    getSupplierBalance(supabase, id),
    supabase.from("supplier_transactions").select("*").eq("supplier_id", id).order("created_at", { ascending: false }),
    getSupplierProducts(supabase, id),
  ]);

  if (transactionsResult.error) throw transactionsResult.error;

  return { supplier, balance, transactions: transactionsResult.data ?? [], products };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- suppliers.service`
Expected: PASS (all previous tests plus the 2 new ones)

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add services/suppliers.service.ts services/suppliers.service.test.ts types/supplier.ts
git commit -m "feat: add supplier-product linking and supplier detail read"
```

---

### Task 5: Nav wiring, `useSuppliers` hook, and the list/add/edit screen

**Files:**
- Modify: `components/shared/navLinks.ts`
- Create: `hooks/useSuppliers.ts`
- Create: `app/(dashboard)/suppliers/page.tsx`
- Create: `components/features/suppliers/SupplierList.tsx`
- Create: `components/features/suppliers/SupplierForm.tsx`

**Interfaces:**
- Consumes: `listSuppliers`, `createSupplier`, `updateSupplier` (Task 2), `SupplierWithBalance`, `Supplier` (Task 2), `useAuth()` (existing `context/AuthContext.tsx`), `Card`/`Button`/`Input`/`Modal` (existing `components/ui/*`), `BackToSettingsLink` (existing).
- Produces: a working `/suppliers` screen (search, list with balances, add, edit) reachable from `/settings`. `SupplierList`'s `onSelect`/`onEdit` props and the page's supplier-detail state plumbing are extended in Task 6 — this task only needs `onSelect` to update local state (the detail view itself is added next task).

- [ ] **Step 1: Add the nav link**

In `components/shared/navLinks.ts`, add `Truck` to the `lucide-react` import:

```ts
import { ShoppingCart, Package, Settings as SettingsIcon, BarChart3, Users, Archive as ArchiveIcon, Landmark, Store, Truck, type LucideIcon } from "lucide-react";
```

Add a new entry to `SETTINGS_LINKS` (after the `"الموظفون"` entry):

```ts
  { href: "/suppliers", label: "الموردون", adminOnly: true, icon: Truck },
```

Add `"/suppliers"` to `SETTINGS_PATHS`:

```ts
const SETTINGS_PATHS = ["/settings", "/sales", "/customers", "/archive", "/employees", "/settings/store", "/suppliers"];
```

- [ ] **Step 2: Create `hooks/useSuppliers.ts`**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listSuppliers } from "@/services/suppliers.service";
import type { SupplierWithBalance } from "@/types/supplier";

/** Loads the supplier list for the /suppliers screen, optionally filtered by a search term. */
export function useSuppliers(search?: string) {
  const [data, setData] = useState<SupplierWithBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await listSuppliers(supabase, { search });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل قائمة الموردين");
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, isLoading, error, reload };
}
```

- [ ] **Step 3: Create `components/features/suppliers/SupplierList.tsx`**

```tsx
"use client";

import { Pencil } from "lucide-react";
import type { SupplierWithBalance } from "@/types/supplier";
import { formatCurrency, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface SupplierListProps {
  suppliers: SupplierWithBalance[];
  onSelect: (supplier: SupplierWithBalance) => void;
  onEdit: (supplier: SupplierWithBalance) => void;
}

/** Presentational list of suppliers — mirrors CustomerList's Card/divide layout. Clicking a row (not the pencil) selects the supplier for detail view. */
export function SupplierList({ suppliers, onSelect, onEdit }: SupplierListProps) {
  if (suppliers.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا يوجد موردون بعد</p>;
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col divide-y divide-gray-100">
        {suppliers.map((supplier) => (
          <div
            key={supplier.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(supplier)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSelect(supplier);
            }}
            className="flex cursor-pointer items-center justify-between gap-3 p-4 hover:bg-gray-50"
          >
            <div className="flex flex-col gap-1">
              <p className="font-medium text-gray-900">{supplier.name}</p>
              {supplier.phone ? <p className="text-xs text-gray-500">{supplier.phone}</p> : null}
            </div>

            <div className="flex items-center gap-3">
              <span className={cn("text-sm font-semibold", supplier.balance > 0 ? "text-red-600" : "text-gray-900")}>
                {formatCurrency(supplier.balance)}
              </span>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(supplier);
                }}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="تعديل"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Create `components/features/suppliers/SupplierForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createSupplier, updateSupplier } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import type { Supplier } from "@/types/supplier";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface SupplierFormProps {
  supplier?: Supplier | null;
  onSaved: (supplier: Supplier) => void;
  onCancel: () => void;
}

/** Create/edit form for a supplier (name, phone, address, note, opening balance) — mirrors CustomerForm's create-or-edit shape. */
export function SupplierForm({ supplier, onSaved, onCancel }: SupplierFormProps) {
  const { user, storeId } = useAuth();
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [note, setNote] = useState(supplier?.note ?? "");
  const [openingBalance, setOpeningBalance] = useState(String(supplier?.opening_balance ?? 0));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const supabase = createClient();
      const actorId = user?.id ?? null;

      const saved = supplier
        ? await updateSupplier(
            supabase,
            supplier.id,
            {
              name: name.trim(),
              phone: phone.trim() || null,
              address: address.trim() || null,
              note: note.trim() || null,
              opening_balance: Number(openingBalance) || 0,
            },
            actorId,
            storeId,
          )
        : await createSupplier(
            supabase,
            {
              name,
              phone: phone.trim() || null,
              address: address.trim() || null,
              note: note.trim() || null,
              openingBalance: Number(openingBalance) || 0,
            },
            actorId,
            storeId,
          );

      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ بيانات المورد");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input label="اسم المورد" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />

      <Input label="رقم الهاتف (اختياري)" value={phone} onChange={(event) => setPhone(event.target.value)} />

      <Input label="العنوان (اختياري)" value={address} onChange={(event) => setAddress(event.target.value)} />

      <Input
        type="number"
        label="الرصيد الافتتاحي (دين سابق قبل النظام)"
        min={0}
        value={openingBalance}
        onChange={(event) => setOpeningBalance(event.target.value)}
      />

      <Input label="ملاحظات (اختياري)" value={note} onChange={(event) => setNote(event.target.value)} />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Create `app/(dashboard)/suppliers/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSuppliers } from "@/hooks/useSuppliers";
import type { Supplier, SupplierWithBalance } from "@/types/supplier";
import { SupplierList } from "@/components/features/suppliers/SupplierList";
import { SupplierForm } from "@/components/features/suppliers/SupplierForm";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

export default function SuppliersPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [search, setSearch] = useState("");
  const suppliers = useSuppliers(search || undefined);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لإدارة الموردين.</p>
      </div>
    );
  }

  function handleSelect(_supplier: SupplierWithBalance) {
    // Wired up in the next task alongside SupplierDetail.
  }

  function handleEdit(supplier: SupplierWithBalance) {
    setEditingSupplier(supplier);
    setIsFormModalOpen(true);
  }

  function openAddModal() {
    setEditingSupplier(null);
    setIsFormModalOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToSettingsLink />
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">الموردون</h1>
          <Button size="sm" onClick={openAddModal}>
            + مورد جديد
          </Button>
        </div>
      </div>

      <Input
        type="text"
        placeholder="ابحث بالاسم أو رقم الهاتف"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {suppliers.isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : suppliers.error ? (
        <p className="p-6 text-center text-red-600">{suppliers.error}</p>
      ) : (
        <SupplierList suppliers={suppliers.data} onSelect={handleSelect} onEdit={handleEdit} />
      )}

      <Modal
        open={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={editingSupplier ? "تعديل بيانات المورد" : "مورد جديد"}
      >
        <SupplierForm
          supplier={editingSupplier}
          onSaved={() => {
            setIsFormModalOpen(false);
            void suppliers.reload();
          }}
          onCancel={() => setIsFormModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck, lint, and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add components/shared/navLinks.ts hooks/useSuppliers.ts "app/(dashboard)/suppliers/page.tsx" components/features/suppliers/SupplierList.tsx components/features/suppliers/SupplierForm.tsx
git commit -m "feat: add suppliers list/add/edit screen"
```

---

### Task 6: `SupplierDetail` — ledger view + purchase/payment actions

**Files:**
- Create: `components/features/suppliers/SupplierDetail.tsx`
- Modify: `app/(dashboard)/suppliers/page.tsx`

**Interfaces:**
- Consumes: `getSupplier`, `SupplierDetailData`, `recordSupplierPurchase`, `recordSupplierPayment` (Task 4/3), `useAuth()`, `Card`/`Button`/`Input`/`Modal` (existing).
- Produces: full drill-down navigation on the `/suppliers` page (list → detail → back), consumed as-is by Task 7 (which only adds a section inside this component).

- [ ] **Step 1: Create `components/features/suppliers/SupplierDetail.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { recordSupplierPurchase, recordSupplierPayment } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import type { SupplierDetailData } from "@/services/suppliers.service";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

interface SupplierDetailProps {
  detail: SupplierDetailData;
  onBack: () => void;
  onChanged: () => void;
}

/** Full transaction history + purchase/payment recording for one supplier. Linked-products management is added by SupplierProductPicker (rendered by the caller alongside this component). */
export function SupplierDetail({ detail, onBack, onChanged }: SupplierDetailProps) {
  const { user, storeId } = useAuth();
  const { supplier, balance, transactions } = detail;

  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  function openPurchaseModal() {
    setPurchaseAmount("");
    setPurchaseError(null);
    setIsPurchaseModalOpen(true);
  }

  async function handleSubmitPurchase(event: FormEvent) {
    event.preventDefault();
    setPurchaseError(null);
    setIsSubmittingPurchase(true);

    if (!storeId) {
      setPurchaseError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      setIsSubmittingPurchase(false);
      return;
    }

    try {
      const supabase = createClient();
      await recordSupplierPurchase(
        supabase,
        { supplierId: supplier.id, amount: Number(purchaseAmount) || 0 },
        user?.id ?? null,
        storeId,
      );
      setIsPurchaseModalOpen(false);
      onChanged();
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : "تعذر تسجيل الفاتورة");
    } finally {
      setIsSubmittingPurchase(false);
    }
  }

  function openPaymentModal() {
    setPaymentAmount(String(balance));
    setPaymentError(null);
    setIsPaymentModalOpen(true);
  }

  async function handleSubmitPayment(event: FormEvent) {
    event.preventDefault();
    setPaymentError(null);
    setIsSubmittingPayment(true);

    if (!storeId) {
      setPaymentError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      setIsSubmittingPayment(false);
      return;
    }

    try {
      const supabase = createClient();
      await recordSupplierPayment(
        supabase,
        { supplierId: supplier.id, amount: Number(paymentAmount) || 0 },
        user?.id ?? null,
        storeId,
      );
      setIsPaymentModalOpen(false);
      onChanged();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "تعذر تسجيل الدفعة");
    } finally {
      setIsSubmittingPayment(false);
    }
  }

  // Transactions arrive newest-first (services/suppliers.service.ts#getSupplier) — walk oldest-to-newest to compute each row's running balance (seeded from opening_balance), then display newest-first.
  const chronological = [...transactions].reverse();
  let cursor = supplier.opening_balance;
  const runningBalanceById = new Map<string, number>();
  chronological.forEach((transaction) => {
    cursor += transaction.type === "purchase" ? transaction.amount : -transaction.amount;
    runningBalanceById.set(transaction.id, cursor);
  });

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
      >
        <ArrowRight className="h-4 w-4" />
        رجوع لقائمة الموردين
      </button>

      <div>
        <h2 className="text-lg font-bold text-gray-900">{supplier.name}</h2>
        {supplier.phone ? <p className="text-sm text-gray-500">{supplier.phone}</p> : null}
      </div>

      <Card>
        <p className="text-sm text-gray-500">الرصيد المستحق</p>
        <p className={cn("text-xl font-bold", balance > 0 ? "text-red-600" : "text-gray-900")}>
          {formatCurrency(balance)}
        </p>
      </Card>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={openPurchaseModal}>
          تسجيل فاتورة شراء
        </Button>
        <Button variant="secondary" className="flex-1" disabled={balance <= 0} onClick={openPaymentModal}>
          تسجيل دفعة
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-700">الحركات</h3>
        {transactions.length === 0 ? (
          <p className="p-6 text-center text-gray-400">لا توجد حركات مسجلة</p>
        ) : (
          <Card className="p-0">
            <div className="flex flex-col divide-y divide-gray-100">
              {transactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-gray-900">
                      {transaction.type === "purchase" ? "فاتورة شراء" : "دفعة"}
                    </p>
                    <p className="text-xs text-gray-400">{formatDateTime(transaction.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={cn("text-sm font-semibold", transaction.type === "purchase" ? "text-red-600" : "text-green-600")}>
                      {transaction.type === "purchase" ? "+" : "-"}
                      {formatCurrency(transaction.amount)}
                    </span>
                    <span className="text-xs text-gray-400">
                      الرصيد: {formatCurrency(runningBalanceById.get(transaction.id) ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Modal open={isPurchaseModalOpen} onClose={() => setIsPurchaseModalOpen(false)} title="تسجيل فاتورة شراء">
        <form onSubmit={handleSubmitPurchase} className="flex flex-col gap-4">
          <Input
            type="number"
            label="مبلغ الفاتورة"
            autoFocus
            min={0}
            value={purchaseAmount}
            onChange={(event) => setPurchaseAmount(event.target.value)}
          />
          {purchaseError ? <p className="text-sm text-red-600">{purchaseError}</p> : null}
          <Button type="submit" size="lg" disabled={isSubmittingPurchase}>
            {isSubmittingPurchase ? "جارٍ الحفظ..." : "تأكيد الفاتورة"}
          </Button>
        </form>
      </Modal>

      <Modal open={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="تسجيل دفعة">
        <form onSubmit={handleSubmitPayment} className="flex flex-col gap-4">
          <div className="flex justify-between text-sm text-gray-500">
            <span>الرصيد المستحق</span>
            <span className="font-medium text-gray-900">{formatCurrency(balance)}</span>
          </div>
          <Input
            type="number"
            label="مبلغ الدفعة"
            autoFocus
            min={0}
            max={balance}
            value={paymentAmount}
            onChange={(event) => setPaymentAmount(event.target.value)}
          />
          {paymentError ? <p className="text-sm text-red-600">{paymentError}</p> : null}
          <Button type="submit" size="lg" disabled={isSubmittingPayment}>
            {isSubmittingPayment ? "جارٍ الحفظ..." : "تأكيد الدفعة"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Wire selection/back navigation into `app/(dashboard)/suppliers/page.tsx`**

Replace the full file content with:

```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSupplier } from "@/services/suppliers.service";
import type { SupplierDetailData } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import { useSuppliers } from "@/hooks/useSuppliers";
import type { Supplier, SupplierWithBalance } from "@/types/supplier";
import { SupplierList } from "@/components/features/suppliers/SupplierList";
import { SupplierDetail } from "@/components/features/suppliers/SupplierDetail";
import { SupplierForm } from "@/components/features/suppliers/SupplierForm";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

export default function SuppliersPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [search, setSearch] = useState("");
  const suppliers = useSuppliers(search || undefined);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupplierDetailData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لإدارة الموردين.</p>
      </div>
    );
  }

  async function loadDetail(id: string) {
    setIsLoadingDetail(true);
    try {
      const supabase = createClient();
      const result = await getSupplier(supabase, id);
      setDetail(result);
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function handleSelect(supplier: SupplierWithBalance) {
    setSelectedSupplierId(supplier.id);
    void loadDetail(supplier.id);
  }

  function handleEdit(supplier: SupplierWithBalance) {
    setEditingSupplier(supplier);
    setIsFormModalOpen(true);
  }

  function openAddModal() {
    setEditingSupplier(null);
    setIsFormModalOpen(true);
  }

  function handleBack() {
    setSelectedSupplierId(null);
    setDetail(null);
  }

  if (selectedSupplierId) {
    return (
      <div className="flex flex-col gap-6">
        {isLoadingDetail || !detail ? (
          <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
        ) : (
          <SupplierDetail
            detail={detail}
            onBack={handleBack}
            onChanged={() => {
              void loadDetail(selectedSupplierId);
              void suppliers.reload();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToSettingsLink />
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">الموردون</h1>
          <Button size="sm" onClick={openAddModal}>
            + مورد جديد
          </Button>
        </div>
      </div>

      <Input
        type="text"
        placeholder="ابحث بالاسم أو رقم الهاتف"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {suppliers.isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : suppliers.error ? (
        <p className="p-6 text-center text-red-600">{suppliers.error}</p>
      ) : (
        <SupplierList suppliers={suppliers.data} onSelect={handleSelect} onEdit={handleEdit} />
      )}

      <Modal
        open={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={editingSupplier ? "تعديل بيانات المورد" : "مورد جديد"}
      >
        <SupplierForm
          supplier={editingSupplier}
          onSaved={() => {
            setIsFormModalOpen(false);
            void suppliers.reload();
          }}
          onCancel={() => setIsFormModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, lint, and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/features/suppliers/SupplierDetail.tsx "app/(dashboard)/suppliers/page.tsx"
git commit -m "feat: add supplier ledger detail view with purchase/payment actions"
```

---

### Task 7: `SupplierProductPicker` — linked-products management

**Files:**
- Create: `components/features/suppliers/SupplierProductPicker.tsx`
- Modify: `components/features/suppliers/SupplierDetail.tsx`

**Interfaces:**
- Consumes: `searchProducts(supabase, query): Promise<Product[]>` (existing `services/products.service.ts`), `getSupplierProducts`, `linkSupplierProduct`, `unlinkSupplierProduct` (Task 4), `SupplierProductWithDetails` (Task 4), `useAuth()`.
- Produces: linked-products section rendered inside `SupplierDetail`, no new exports consumed elsewhere.

- [ ] **Step 1: Create `components/features/suppliers/SupplierProductPicker.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { searchProducts } from "@/services/products.service";
import { linkSupplierProduct, unlinkSupplierProduct } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import type { Product } from "@/types/product";
import type { SupplierProductWithDetails } from "@/types/supplier";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

interface SupplierProductPickerProps {
  supplierId: string;
  products: SupplierProductWithDetails[];
  onChanged: () => void;
}

/** Linked-products section on the supplier detail screen: list of currently-linked products (with per-supplier cost), "+ ربط منتج" opens a search-and-pick modal. */
export function SupplierProductPicker({ supplierId, products, onChanged }: SupplierProductPickerProps) {
  const { storeId } = useAuth();

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pickedProduct, setPickedProduct] = useState<Product | null>(null);
  const [costPrice, setCostPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const linkedProductIds = new Set(products.map((row) => row.product_id));

  function openPicker() {
    setQuery("");
    setResults([]);
    setPickedProduct(null);
    setCostPrice("");
    setError(null);
    setIsPickerOpen(true);
  }

  async function handleSearch(term: string) {
    setQuery(term);
    setPickedProduct(null);
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const supabase = createClient();
      const found = await searchProducts(supabase, term.trim());
      setResults(found);
    } finally {
      setIsSearching(false);
    }
  }

  function pickProduct(product: Product) {
    setPickedProduct(product);
    setCostPrice(String(product.cost_price));
  }

  async function handleLink(event: FormEvent) {
    event.preventDefault();
    if (!pickedProduct) return;
    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      await linkSupplierProduct(
        supabase,
        { supplierId, productId: pickedProduct.id, costPrice: Number(costPrice) || null },
        storeId,
      );
      setIsPickerOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر ربط المنتج");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnlink(productId: string) {
    const supabase = createClient();
    await unlinkSupplierProduct(supabase, supplierId, productId);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">المنتجات المرتبطة</h3>
        <Button size="sm" variant="secondary" onClick={openPicker}>
          <Plus className="h-4 w-4" />
          ربط منتج
        </Button>
      </div>

      {products.length === 0 ? (
        <p className="p-6 text-center text-gray-400">لا توجد منتجات مرتبطة بهذا المورد بعد</p>
      ) : (
        <Card className="p-0">
          <div className="flex flex-col divide-y divide-gray-100">
            {products.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-gray-900">{row.product.name}</p>
                  <p className="text-xs text-gray-400">{row.product.barcode}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCurrency(row.cost_price ?? row.product.cost_price)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleUnlink(row.product_id)}
                    className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    aria-label="إلغاء الربط"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={isPickerOpen} onClose={() => setIsPickerOpen(false)} title="ربط منتج بالمورد">
        <div className="flex flex-col gap-4">
          <Input
            type="text"
            placeholder="ابحث باسم المنتج"
            value={query}
            onChange={(event) => void handleSearch(event.target.value)}
            autoFocus
          />

          {isSearching ? (
            <p className="p-4 text-center text-sm text-gray-400">جارٍ البحث...</p>
          ) : results.length > 0 ? (
            <div className="flex max-h-48 flex-col divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100">
              {results.map((product) => {
                const alreadyLinked = linkedProductIds.has(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={alreadyLinked}
                    onClick={() => pickProduct(product)}
                    className="flex items-center justify-between gap-3 p-3 text-right hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="text-sm text-gray-900">{product.name}</span>
                    {alreadyLinked ? <span className="text-xs text-gray-400">مرتبط مسبقاً</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {pickedProduct ? (
            <form onSubmit={handleLink} className="flex flex-col gap-4 border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-700">
                المنتج المختار: <span className="font-semibold">{pickedProduct.name}</span>
              </p>
              <Input
                type="number"
                label="سعر الشراء من هذا المورد"
                min={0}
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
              />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" size="lg" disabled={isSaving}>
                {isSaving ? "جارٍ الحفظ..." : "ربط المنتج"}
              </Button>
            </form>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the `Product` type import path used above**

Run: `grep -n "^export type Product " types/product.ts`
Expected: confirms `import type { Product } from "@/types/product";` is correct (same check as Task 4 Step 1 — if the file/export differs, adjust the import in Step 1 accordingly).

- [ ] **Step 3: Embed the picker in `SupplierDetail`**

In `components/features/suppliers/SupplierDetail.tsx`, add the import:

```tsx
import { SupplierProductPicker } from "@/components/features/suppliers/SupplierProductPicker";
```

Change the `SupplierDetailProps`/destructuring to also pull `products`:

```tsx
  const { supplier, balance, transactions, products } = detail;
```

Add the picker section right after the closing `</div>` of the "الحركات" (transactions) block and before the two `<Modal>` elements at the end of the component's JSX:

```tsx
      <SupplierProductPicker supplierId={supplier.id} products={products} onChanged={onChanged} />
```

- [ ] **Step 4: Typecheck, lint, and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/features/suppliers/SupplierProductPicker.tsx components/features/suppliers/SupplierDetail.tsx
git commit -m "feat: add supplier-product linking UI"
```

- [ ] **Step 6: Full verification pass**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: PASS — this is the final task, so this is the whole-feature check (all suppliers tests plus the full existing suite, confirming nothing else broke).

**Manual smoke-test checklist** (for whoever picks this up after the automated pipeline, since there's no headless-browser tooling in this environment to drive it automatically — see the 2026-08-11 precedent in project memory):
1. Log in as admin, open الإعدادات → الموردون, confirm the page loads with an empty list.
2. Add a supplier with an opening balance (e.g. 20000), confirm it appears in the list showing that balance.
3. Open the supplier, confirm "الرصيد المستحق" shows the opening balance with zero transactions listed.
4. Record a purchase (e.g. 10000), confirm the balance becomes 30000 and the transaction appears.
5. Record a payment of 15000, confirm the balance becomes 15000; try to record a payment greater than 15000 and confirm it's rejected with the remaining-balance message.
6. Link a product to the supplier with a custom cost price, confirm it appears in "المنتجات المرتبطة" with that price; link the same product to a second supplier with a different price, confirm both show independently.
7. Unlink the product from one supplier, confirm it disappears from that supplier's list but stays linked to the other.
8. Edit the supplier's name/phone, confirm the change is saved and reflected in the list.
9. Log in as a cashier (non-admin) and confirm الموردون is hidden from /settings and /suppliers shows "هذي الصفحة للمالك فقط".
