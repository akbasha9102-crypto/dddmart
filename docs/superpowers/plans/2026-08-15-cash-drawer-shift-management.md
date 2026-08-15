# Cash Drawer / Shift Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every cashier a shift lifecycle (open with a starting cash balance → sell → close with a physical count) and give admins a report that flags cash shortages/surpluses per shift.

**Architecture:** One new `shifts` table (stateful: open → closed) plus one new nullable column on `customer_transactions`. Sales/debt-payments/returns are NOT linked to a shift by foreign key — they're attributed to a shift by `cashier_id` + falling inside `[opened_at, closeTime)`, matching this repo's existing convention for netting damage/reconciliation/returns into reporting. A new `services/shifts.service.ts` holds all the logic; POS gets a blocking "open shift" modal and a "close shift" button; a new admin-only `/shifts` page lists shifts and lets an admin force-close a stuck one.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (`@supabase/ssr`/`@supabase/supabase-js`), Tailwind CSS, Vitest (hand-rolled Supabase fakes, no real DB in tests).

**Spec:** `docs/superpowers/specs/2026-08-15-cash-drawer-shift-management-design.md`

## Global Constraints

- All user-facing text is Arabic (RTL), matching every existing screen in this app.
- Currency values are displayed via the existing `formatCurrency` helper (`lib/utils.ts`) — never format currency inline.
- Every table read/write goes through RLS scoped by `store_id = current_store_id()`; never add an explicit `.eq("store_id", ...)` filter to a `select()` — that's not this repo's convention (see `getDamagesInRange`, `getCashierRanking`). Only `insert()` calls need an explicit `store_id` value, since RLS can't infer it.
- New migration file is `supabase/migrations/00000000000018_cash_drawer_shifts.sql` — do not renumber existing migrations.
- `types/database.types.ts` is hand-authored (no `supabase gen types` pipeline in this repo) — edit it directly to match the migration exactly.
- Closed shift rows are never updated or deleted again — same append-once convention as `returns`/`stock_damages`/`stock_reconciliations`.
- Every task's commit must leave `npm run typecheck` and `npm run lint` clean, and `npm run test` passing for every test file that exists at that point. A full `npm run build` runs at the end of the last task.
- No new npm dependencies are needed for this feature.

---

### Task 1: Database schema + TypeScript types

**Files:**
- Create: `supabase/migrations/00000000000018_cash_drawer_shifts.sql`
- Create: `types/shifts.ts`
- Modify: `types/database.types.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Database["public"]["Tables"]["shifts"]` (Row/Insert/Update/Relationships), `Database["public"]["Tables"]["customer_transactions"]` gains `cashier_id`, `ShiftStatus` type (`"open" | "closed"`), `OperationActionType` gains `"shift_opened" | "shift_closed"`, `OperationEntityType` gains `"shift"`, `types/shifts.ts` exports `Shift` and `ShiftWithCashierName`. All later tasks import `Shift`/`ShiftWithCashierName` from `@/types/shifts` and reference `shifts`/`customer_transactions.cashier_id` in Supabase queries.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Add `ShiftStatus`, `OperationActionType`, and `OperationEntityType` entries**

In `types/database.types.ts`, near the other top-level type aliases (right after `export type PaymentMethod = "cash" | "credit";`), add:

```typescript
export type ShiftStatus = "open" | "closed";
```

Change the `OperationActionType` union to add two new members at the end (right before the closing `;`):

```typescript
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
  | "supplier_payment_recorded"
  | "shift_opened"
  | "shift_closed";
```

Change `OperationEntityType` to add `"shift"`:

```typescript
export type OperationEntityType = "product" | "category" | "sale" | "stock" | "customer" | "supplier" | "shift";
```

- [ ] **Step 3: Add `cashier_id` to `customer_transactions` in `types/database.types.ts`**

Find the `customer_transactions` table block (`Row`/`Insert`/`Update`) and add `cashier_id` to all three, plus a new relationship entry:

```typescript
      customer_transactions: {
        Row: {
          id: string;
          customer_id: string;
          type: CustomerTransactionType;
          amount: number;
          sale_id: string | null;
          cashier_id: string | null;
          note: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          type: CustomerTransactionType;
          amount: number;
          sale_id?: string | null;
          cashier_id?: string | null;
          note?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          type?: CustomerTransactionType;
          amount?: number;
          sale_id?: string | null;
          cashier_id?: string | null;
          note?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_transactions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_transactions_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_transactions_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
```

This replaces the existing `customer_transactions` block exactly (same file location, right before the `suppliers:` block).

- [ ] **Step 4: Add the `shifts` table block to `types/database.types.ts`**

Insert this new block immediately after the `stock_reconciliations` block ends and before the `suppliers:` block begins:

```typescript
      shifts: {
        Row: {
          id: string;
          cashier_id: string | null;
          store_id: string;
          status: ShiftStatus;
          opening_balance: number;
          opened_at: string;
          closed_at: string | null;
          expected_amount: number | null;
          counted_amount: number | null;
          difference: number | null;
          forced_closed_by: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cashier_id?: string | null;
          store_id: string;
          status?: ShiftStatus;
          opening_balance: number;
          opened_at?: string;
          closed_at?: string | null;
          expected_amount?: number | null;
          counted_amount?: number | null;
          difference?: number | null;
          forced_closed_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          cashier_id?: string | null;
          store_id?: string;
          status?: ShiftStatus;
          opening_balance?: number;
          opened_at?: string;
          closed_at?: string | null;
          expected_amount?: number | null;
          counted_amount?: number | null;
          difference?: number | null;
          forced_closed_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shifts_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_forced_closed_by_fkey";
            columns: ["forced_closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 5: Create `types/shifts.ts`**

```typescript
import type { Database } from "./database.types";

export type Shift = Database["public"]["Tables"]["shifts"]["Row"];

export interface ShiftWithCashierName extends Shift {
  cashierName: string;
}
```

- [ ] **Step 6: Verify it all compiles**

Run: `npm run typecheck`
Expected: no errors (this task adds only types + a migration file, no runtime code references them yet).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00000000000018_cash_drawer_shifts.sql types/shifts.ts types/database.types.ts
git commit -m "feat: add shifts table schema and types for cash drawer management"
```

---

### Task 2: `shifts.service.ts` — open/get shift

**Files:**
- Create: `services/shifts.service.ts`
- Test: `services/shifts.service.test.ts`

**Interfaces:**
- Consumes: `Shift` from `@/types/shifts` (Task 1), `logOperation` from `@/services/archive.service` (existing).
- Produces: `getOpenShift(supabase, cashierId: string): Promise<Shift | null>`, `openShift(supabase, params: OpenShiftParams, cashierId: string, storeId: string): Promise<Shift>`, `OpenShiftParams { openingBalance: number }`. Task 7 (`useShift` hook) calls both of these directly.

- [ ] **Step 1: Write the failing tests**

Create `services/shifts.service.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenShift, openShift } from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

const OPEN_SHIFT: Shift = {
  id: "shift-1",
  cashier_id: "cashier-1",
  store_id: "store-1",
  status: "open",
  opening_balance: 50000,
  opened_at: "2026-08-15T08:00:00.000Z",
  closed_at: null,
  expected_amount: null,
  counted_amount: null,
  difference: null,
  forced_closed_by: null,
  note: null,
  created_at: "2026-08-15T08:00:00.000Z",
};

/**
 * Hand-rolled fake covering the exact chains getOpenShift/openShift exercise:
 * shifts.select().eq().eq().maybeSingle() (getOpenShift) and
 * shifts.insert().select().single() plus operations_log.insert()
 * (logOperation), matching the style of reconciliations.service.test.ts.
 */
function createFakeSupabase(options: {
  openShiftRow?: Shift | null;
  insertedShift?: Shift;
}): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedShift ?? null, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "shifts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: options.openShiftRow ?? null, error: null }),
              }),
            }),
          }),
          insert: insertSpy,
        };
      }
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, insertSpy, logInsertSpy };
}

describe("getOpenShift", () => {
  it("returns null when the cashier has no open shift", async () => {
    const { supabase } = createFakeSupabase({ openShiftRow: null });
    expect(await getOpenShift(supabase, "cashier-1")).toBeNull();
  });

  it("returns the open shift row when one exists", async () => {
    const { supabase } = createFakeSupabase({ openShiftRow: OPEN_SHIFT });
    expect(await getOpenShift(supabase, "cashier-1")).toEqual(OPEN_SHIFT);
  });
});

describe("openShift", () => {
  it("rejects a negative opening balance", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ openShiftRow: null });
    await expect(openShift(supabase, { openingBalance: -1 }, "cashier-1", "store-1")).rejects.toThrow(
      "الرصيد الافتتاحي",
    );
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("creates a new shift and logs shift_opened when none is open", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabase({
      openShiftRow: null,
      insertedShift: OPEN_SHIFT,
    });

    const result = await openShift(supabase, { openingBalance: 50000 }, "cashier-1", "store-1");

    expect(result).toEqual(OPEN_SHIFT);
    expect(insertSpy).toHaveBeenCalledWith({
      cashier_id: "cashier-1",
      store_id: "store-1",
      opening_balance: 50000,
    });
    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "shift_opened", entity_id: OPEN_SHIFT.id }),
    );
  });

  it("returns the existing open shift instead of creating a duplicate", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ openShiftRow: OPEN_SHIFT });

    const result = await openShift(supabase, { openingBalance: 99999 }, "cashier-1", "store-1");

    expect(result).toEqual(OPEN_SHIFT);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run services/shifts.service.test.ts`
Expected: FAIL — `services/shifts.service.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Write the implementation**

Create `services/shifts.service.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/** The cashier's currently open shift, or null if they don't have one. */
export async function getOpenShift(supabase: Client, cashierId: string): Promise<Shift | null> {
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("cashier_id", cashierId)
    .eq("status", "open")
    .maybeSingle();

  if (error) throw error;
  return data;
}

export interface OpenShiftParams {
  openingBalance: number;
}

/**
 * Opens a new shift for a cashier. Idempotent: if the cashier already has
 * an open shift (e.g. a refresh/re-login, or a double-submit), returns the
 * existing row instead of inserting a duplicate. The DB's partial unique
 * index (shifts_one_open_per_cashier) is the hard backstop for a genuine race.
 */
export async function openShift(
  supabase: Client,
  params: OpenShiftParams,
  cashierId: string,
  storeId: string,
): Promise<Shift> {
  const existing = await getOpenShift(supabase, cashierId);
  if (existing) return existing;

  if (params.openingBalance < 0) {
    throw new Error("الرصيد الافتتاحي يجب أن يكون صفر أو أكبر");
  }

  const { data, error } = await supabase
    .from("shifts")
    .insert({
      cashier_id: cashierId,
      store_id: storeId,
      opening_balance: params.openingBalance,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: cashierId,
    actionType: "shift_opened",
    entityType: "shift",
    entityId: data.id,
    description: `تم فتح وردية جديدة برصيد افتتاحي ${params.openingBalance}`,
    storeId,
  });

  return data;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/shifts.service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/shifts.service.ts services/shifts.service.test.ts
git commit -m "feat: add getOpenShift/openShift to shifts service"
```

---

### Task 3: `shifts.service.ts` — expected-amount calculation

**Files:**
- Modify: `services/shifts.service.ts`
- Test: `services/shifts.service.expectedAmount.test.ts`

**Interfaces:**
- Consumes: `Shift` from `@/types/shifts` (Task 1).
- Produces: `getCashSalesSum(supabase, cashierId, fromIso, toIso): Promise<number>`, `getCashDebtPaymentsSum(supabase, cashierId, fromIso, toIso): Promise<number>`, `getCashRefundsSum(supabase, cashierId, fromIso, toIso): Promise<number>`, `calculateExpectedAmount(supabase, shift: Shift, closeTime: Date): Promise<number>`. Task 4 (`closeShift`) and Task 9 (`CloseShiftModal`, as a live preview) both call `calculateExpectedAmount`.

- [ ] **Step 1: Write the failing tests**

Create `services/shifts.service.expectedAmount.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCashSalesSum,
  getCashDebtPaymentsSum,
  getCashRefundsSum,
  calculateExpectedAmount,
} from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

interface SaleFixture {
  total_amount: number;
}

interface PaymentFixture {
  amount: number;
}

interface ReturnFixture {
  sale_id: string;
  refund_amount: number;
}

interface SalePaymentMethodFixture {
  id: string;
  payment_method: "cash" | "credit";
}

/**
 * Hand-rolled fake covering: sales.select().eq().eq().gte().lte() (cash
 * sales sum), customer_transactions.select().eq().eq().gte().lte() (cash
 * debt payments sum), returns.select().eq().gte().lte() (returns by actor)
 * plus sales.select().in() (resolving each return's original payment
 * method) -- matches the style of sales.service.cashier.test.ts.
 */
function createFakeSupabase(fixtures: {
  cashSales?: SaleFixture[];
  payments?: PaymentFixture[];
  returns?: ReturnFixture[];
  originSales?: SalePaymentMethodFixture[];
}): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "sales") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: async () => ({ data: fixtures.cashSales ?? [], error: null }),
                }),
              }),
            }),
            in: async (column: string, values: string[]) => {
              if (column !== "id") throw new Error(`unexpected sales.in column ${column}`);
              const rows = (fixtures.originSales ?? []).filter((row) => values.includes(row.id));
              return { data: rows, error: null };
            },
          }),
        };
      }
      if (table === "customer_transactions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: async () => ({ data: fixtures.payments ?? [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "returns") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: async () => ({ data: fixtures.returns ?? [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getCashSalesSum", () => {
  it("sums total_amount across the given rows", async () => {
    const supabase = createFakeSupabase({ cashSales: [{ total_amount: 1000 }, { total_amount: 2500 }] });
    expect(await getCashSalesSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z")).toBe(
      3500,
    );
  });

  it("returns 0 when there are no cash sales", async () => {
    const supabase = createFakeSupabase({ cashSales: [] });
    expect(await getCashSalesSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z")).toBe(
      0,
    );
  });
});

describe("getCashDebtPaymentsSum", () => {
  it("sums payment amounts across the given rows", async () => {
    const supabase = createFakeSupabase({ payments: [{ amount: 500 }, { amount: 1500 }] });
    expect(
      await getCashDebtPaymentsSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z"),
    ).toBe(2000);
  });
});

describe("getCashRefundsSum", () => {
  it("only counts refunds on returns whose original sale was paid in cash", async () => {
    const supabase = createFakeSupabase({
      returns: [
        { sale_id: "sale-cash", refund_amount: 300 },
        { sale_id: "sale-credit", refund_amount: 700 },
      ],
      originSales: [
        { id: "sale-cash", payment_method: "cash" },
        { id: "sale-credit", payment_method: "credit" },
      ],
    });

    expect(
      await getCashRefundsSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z"),
    ).toBe(300);
  });

  it("returns 0 when there are no returns", async () => {
    const supabase = createFakeSupabase({ returns: [] });
    expect(
      await getCashRefundsSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z"),
    ).toBe(0);
  });
});

describe("calculateExpectedAmount", () => {
  const BASE_SHIFT: Shift = {
    id: "shift-1",
    cashier_id: "cashier-1",
    store_id: "store-1",
    status: "open",
    opening_balance: 10000,
    opened_at: "2026-08-15T08:00:00.000Z",
    closed_at: null,
    expected_amount: null,
    counted_amount: null,
    difference: null,
    forced_closed_by: null,
    note: null,
    created_at: "2026-08-15T08:00:00.000Z",
  };

  it("adds opening balance + cash sales + cash debt payments, minus cash refunds", async () => {
    const supabase = createFakeSupabase({
      cashSales: [{ total_amount: 20000 }],
      payments: [{ amount: 5000 }],
      returns: [{ sale_id: "sale-cash", refund_amount: 1000 }],
      originSales: [{ id: "sale-cash", payment_method: "cash" }],
    });

    const expected = await calculateExpectedAmount(supabase, BASE_SHIFT, new Date("2026-08-15T16:00:00.000Z"));

    // 10000 + 20000 + 5000 - 1000
    expect(expected).toBe(34000);
  });

  it("returns just the opening balance when there's no activity", async () => {
    const supabase = createFakeSupabase({});
    const expected = await calculateExpectedAmount(supabase, BASE_SHIFT, new Date("2026-08-15T16:00:00.000Z"));
    expect(expected).toBe(10000);
  });

  it("returns just the opening balance when the shift's cashier_id is null (deleted profile)", async () => {
    const supabase = createFakeSupabase({ cashSales: [{ total_amount: 99999 }] });
    const expected = await calculateExpectedAmount(
      supabase,
      { ...BASE_SHIFT, cashier_id: null },
      new Date("2026-08-15T16:00:00.000Z"),
    );
    expect(expected).toBe(10000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run services/shifts.service.expectedAmount.test.ts`
Expected: FAIL — none of `getCashSalesSum`/`getCashDebtPaymentsSum`/`getCashRefundsSum`/`calculateExpectedAmount` are exported yet.

- [ ] **Step 3: Add the implementation to `services/shifts.service.ts`**

Append to `services/shifts.service.ts` (after the `openShift` function):

```typescript
/** Sum of a cashier's cash-paid sales in [fromIso, toIso]. */
export async function getCashSalesSum(supabase: Client, cashierId: string, fromIso: string, toIso: string): Promise<number> {
  const { data, error } = await supabase
    .from("sales")
    .select("total_amount")
    .eq("cashier_id", cashierId)
    .eq("payment_method", "cash")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.total_amount, 0);
}

/** Sum of cash debt payments this cashier personally collected in [fromIso, toIso]. */
export async function getCashDebtPaymentsSum(supabase: Client, cashierId: string, fromIso: string, toIso: string): Promise<number> {
  const { data, error } = await supabase
    .from("customer_transactions")
    .select("amount")
    .eq("cashier_id", cashierId)
    .eq("type", "payment")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.amount, 0);
}

/**
 * Sum of refunds this cashier personally processed (returns.actor_id) in
 * [fromIso, toIso], counted ONLY when the original sale was paid in cash --
 * a return on a credit-sale item reduces the customer's debt, not the cash
 * drawer, so it's excluded. Attribution is by who PROCESSED the return
 * (actor_id), not who made the original sale, since it's whoever is
 * physically handing back the cash during their own shift.
 */
export async function getCashRefundsSum(supabase: Client, cashierId: string, fromIso: string, toIso: string): Promise<number> {
  const { data: returnsData, error: returnsError } = await supabase
    .from("returns")
    .select("sale_id, refund_amount")
    .eq("actor_id", cashierId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso);

  if (returnsError) throw returnsError;
  const returns = returnsData ?? [];
  if (returns.length === 0) return 0;

  const saleIds = Array.from(new Set(returns.map((row) => row.sale_id)));
  const { data: salesData, error: salesError } = await supabase.from("sales").select("id, payment_method").in("id", saleIds);
  if (salesError) throw salesError;

  const paymentMethodBySaleId = new Map((salesData ?? []).map((sale) => [sale.id, sale.payment_method]));

  return returns.reduce((sum, row) => {
    return paymentMethodBySaleId.get(row.sale_id) === "cash" ? sum + row.refund_amount : sum;
  }, 0);
}

/**
 * How much cash SHOULD be in the drawer right now for this shift:
 * opening balance + cash sales + cash debt payments - cash refunds, all
 * attributed to the shift's cashier within [opened_at, closeTime].
 *
 * A null cashier_id (only possible if the cashier's profile was deleted
 * after the shift opened) has nothing to attribute activity to, so this
 * falls back to just the opening balance rather than querying with a null id.
 */
export async function calculateExpectedAmount(supabase: Client, shift: Shift, closeTime: Date): Promise<number> {
  if (!shift.cashier_id) return shift.opening_balance;

  const fromIso = shift.opened_at;
  const toIso = closeTime.toISOString();

  const [cashSales, cashPayments, cashRefunds] = await Promise.all([
    getCashSalesSum(supabase, shift.cashier_id, fromIso, toIso),
    getCashDebtPaymentsSum(supabase, shift.cashier_id, fromIso, toIso),
    getCashRefundsSum(supabase, shift.cashier_id, fromIso, toIso),
  ]);

  return shift.opening_balance + cashSales + cashPayments - cashRefunds;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/shifts.service.expectedAmount.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/shifts.service.ts services/shifts.service.expectedAmount.test.ts
git commit -m "feat: add expected cash-drawer amount calculation"
```

---

### Task 4: `shifts.service.ts` — closeShift (normal + forced)

**Files:**
- Modify: `services/shifts.service.ts`
- Test: `services/shifts.service.close.test.ts`

**Interfaces:**
- Consumes: `calculateExpectedAmount` (Task 3), `logOperation` (existing), `Shift` type (Task 1).
- Produces: `closeShift(supabase, params: CloseShiftParams, actorId: string | null, storeId: string, isForced: boolean): Promise<Shift>`, `CloseShiftParams { shiftId: string; countedAmount: number | null }`. Task 7 (`useShift.close`) and Task 10 (admin force-close) both call this.

- [ ] **Step 1: Write the failing tests**

Create `services/shifts.service.close.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeShift } from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

const OPEN_SHIFT: Shift = {
  id: "shift-1",
  cashier_id: "cashier-1",
  store_id: "store-1",
  status: "open",
  opening_balance: 10000,
  opened_at: "2026-08-15T08:00:00.000Z",
  closed_at: null,
  expected_amount: null,
  counted_amount: null,
  difference: null,
  forced_closed_by: null,
  note: null,
  created_at: "2026-08-15T08:00:00.000Z",
};

const CLOSED_SHIFT: Shift = { ...OPEN_SHIFT, status: "closed", closed_at: "2026-08-15T16:00:00.000Z" };

/**
 * Hand-rolled fake covering: shifts.select().eq().maybeSingle() (fetch by
 * id), shifts.update().eq().select().single(), plus the three range
 * queries calculateExpectedAmount issues (sales/customer_transactions/
 * returns, all returning empty so expected_amount == opening_balance
 * unless overridden), and operations_log.insert().
 */
function createFakeSupabase(options: {
  fetchedShift?: Shift | null;
  updatedShift?: Shift;
}): {
  supabase: SupabaseClient<Database>;
  updateSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const updateSpy = vi.fn((patch: Record<string, unknown>) => ({
    eq: () => ({
      select: () => ({
        single: async () => ({ data: options.updatedShift ?? { ...options.fetchedShift, ...patch }, error: null }),
      }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "shifts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options.fetchedShift ?? null, error: null }),
            }),
          }),
          update: updateSpy,
        };
      }
      if (table === "sales") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: [], error: null }) }) }) }),
            in: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "customer_transactions") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: [], error: null }) }) }) }),
          }),
        };
      }
      if (table === "returns") {
        return {
          select: () => ({
            eq: () => ({ gte: () => ({ lte: async () => ({ data: [], error: null }) }) }),
          }),
        };
      }
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, updateSpy, logInsertSpy };
}

describe("closeShift", () => {
  it("throws when the shift doesn't exist", async () => {
    const { supabase } = createFakeSupabase({ fetchedShift: null });
    await expect(
      closeShift(supabase, { shiftId: "missing", countedAmount: 10000 }, "cashier-1", "store-1", false),
    ).rejects.toThrow("لم يتم العثور على الوردية");
  });

  it("throws when the shift is already closed", async () => {
    const { supabase } = createFakeSupabase({ fetchedShift: CLOSED_SHIFT });
    await expect(
      closeShift(supabase, { shiftId: "shift-1", countedAmount: 10000 }, "cashier-1", "store-1", false),
    ).rejects.toThrow("مغلقة أصلاً");
  });

  it("computes a shortage difference on a normal close (counted below expected)", async () => {
    const { supabase, updateSpy, logInsertSpy } = createFakeSupabase({
      fetchedShift: OPEN_SHIFT,
      updatedShift: { ...OPEN_SHIFT, status: "closed", expected_amount: 10000, counted_amount: 9500, difference: -500 },
    });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: 9500 }, "cashier-1", "store-1", false);

    expect(result.difference).toBe(-500);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "closed", expected_amount: 10000, counted_amount: 9500, difference: -500, forced_closed_by: null }),
    );
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "shift_closed" }));
  });

  it("computes a surplus difference on a normal close (counted above expected)", async () => {
    const { supabase } = createFakeSupabase({
      fetchedShift: OPEN_SHIFT,
      updatedShift: { ...OPEN_SHIFT, status: "closed", expected_amount: 10000, counted_amount: 10300, difference: 300 },
    });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: 10300 }, "cashier-1", "store-1", false);

    expect(result.difference).toBe(300);
  });

  it("leaves counted_amount and difference null on a forced close, and sets forced_closed_by", async () => {
    const { supabase, updateSpy } = createFakeSupabase({
      fetchedShift: OPEN_SHIFT,
      updatedShift: { ...OPEN_SHIFT, status: "closed", expected_amount: 10000, counted_amount: null, difference: null, forced_closed_by: "admin-1" },
    });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: null }, "admin-1", "store-1", true);

    expect(result.counted_amount).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.forced_closed_by).toBe("admin-1");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ counted_amount: null, difference: null, forced_closed_by: "admin-1" }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run services/shifts.service.close.test.ts`
Expected: FAIL — `closeShift` is not exported yet.

- [ ] **Step 3: Add the implementation to `services/shifts.service.ts`**

Append to `services/shifts.service.ts`:

```typescript
export interface CloseShiftParams {
  shiftId: string;
  /** The physically counted cash amount. Must be null when isForced is true (nobody counted it). */
  countedAmount: number | null;
}

/**
 * Closes a shift. A normal close (isForced = false) requires a
 * countedAmount and computes the shortage/surplus difference. A forced
 * close (an admin closing a shift the cashier left open) leaves
 * counted_amount/difference null -- nobody physically counted the drawer
 * -- and records forced_closed_by instead.
 */
export async function closeShift(
  supabase: Client,
  params: CloseShiftParams,
  actorId: string | null,
  storeId: string,
  isForced: boolean,
): Promise<Shift> {
  const { data: shift, error: fetchError } = await supabase.from("shifts").select("*").eq("id", params.shiftId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!shift) throw new Error("لم يتم العثور على الوردية");
  if (shift.status === "closed") throw new Error("هذه الوردية مغلقة أصلاً");

  const closeTime = new Date();
  const expectedAmount = await calculateExpectedAmount(supabase, shift, closeTime);
  const countedAmount = isForced ? null : params.countedAmount;
  const difference = countedAmount === null ? null : countedAmount - expectedAmount;

  const { data: updated, error: updateError } = await supabase
    .from("shifts")
    .update({
      status: "closed",
      closed_at: closeTime.toISOString(),
      expected_amount: expectedAmount,
      counted_amount: countedAmount,
      difference,
      forced_closed_by: isForced ? actorId : null,
    })
    .eq("id", params.shiftId)
    .select()
    .single();

  if (updateError) throw updateError;

  const description = isForced
    ? `تم إغلاق وردية الكاشير قسرياً — المتوقع ${expectedAmount}`
    : `تم إغلاق وردية الكاشير — المتوقع ${expectedAmount}، المعدود ${countedAmount}، الفرق ${difference}`;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "shift_closed",
    entityType: "shift",
    entityId: params.shiftId,
    description,
    storeId,
  });

  return updated;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/shifts.service.close.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/shifts.service.ts services/shifts.service.close.test.ts
git commit -m "feat: add closeShift (normal and forced) to shifts service"
```

---

### Task 5: `shifts.service.ts` — admin report query

**Files:**
- Modify: `services/shifts.service.ts`
- Test: `services/shifts.service.report.test.ts`

**Interfaces:**
- Consumes: `ShiftWithCashierName` from `@/types/shifts` (Task 1).
- Produces: `getShiftsForReport(supabase, startDate: Date, endDate: Date): Promise<ShiftWithCashierName[]>`. Task 10 (`ShiftsList`) calls this.

- [ ] **Step 1: Write the failing tests**

Create `services/shifts.service.report.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getShiftsForReport } from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

const SHIFT_A: Shift = {
  id: "shift-a",
  cashier_id: "cashier-1",
  store_id: "store-1",
  status: "closed",
  opening_balance: 10000,
  opened_at: "2026-08-15T08:00:00.000Z",
  closed_at: "2026-08-15T16:00:00.000Z",
  expected_amount: 20000,
  counted_amount: 19500,
  difference: -500,
  forced_closed_by: null,
  note: null,
  created_at: "2026-08-15T08:00:00.000Z",
};

const SHIFT_B: Shift = { ...SHIFT_A, id: "shift-b", cashier_id: "cashier-2" };
const SHIFT_UNKNOWN_CASHIER: Shift = { ...SHIFT_A, id: "shift-c", cashier_id: "deleted-cashier" };

function createFakeSupabase(fixtures: {
  shifts: Shift[];
  profiles: { id: string; full_name: string }[];
}): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "shifts") {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                order: async () => ({ data: fixtures.shifts, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column !== "id") throw new Error(`unexpected profiles.in column ${column}`);
              return { data: fixtures.profiles.filter((profile) => values.includes(profile.id)), error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getShiftsForReport", () => {
  it("returns an empty array when there are no shifts in range", async () => {
    const supabase = createFakeSupabase({ shifts: [], profiles: [] });
    expect(await getShiftsForReport(supabase, new Date("2026-08-15"), new Date("2026-08-15"))).toEqual([]);
  });

  it("attaches each shift's cashier name via a batched profile lookup", async () => {
    const supabase = createFakeSupabase({
      shifts: [SHIFT_A, SHIFT_B],
      profiles: [
        { id: "cashier-1", full_name: "أحمد" },
        { id: "cashier-2", full_name: "سارة" },
      ],
    });

    const result = await getShiftsForReport(supabase, new Date("2026-08-15"), new Date("2026-08-15"));

    expect(result).toEqual([
      { ...SHIFT_A, cashierName: "أحمد" },
      { ...SHIFT_B, cashierName: "سارة" },
    ]);
  });

  it("falls back to 'غير معروف' when a cashier_id has no matching profile row", async () => {
    const supabase = createFakeSupabase({ shifts: [SHIFT_UNKNOWN_CASHIER], profiles: [] });
    const result = await getShiftsForReport(supabase, new Date("2026-08-15"), new Date("2026-08-15"));
    expect(result[0].cashierName).toBe("غير معروف");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run services/shifts.service.report.test.ts`
Expected: FAIL — `getShiftsForReport` is not exported yet.

- [ ] **Step 3: Add the implementation to `services/shifts.service.ts`**

Append to `services/shifts.service.ts`:

```typescript
import type { ShiftWithCashierName } from "@/types/shifts";

/**
 * All shifts opened in [startDate, endDate], newest first, with each
 * cashier's name resolved via a batched profiles lookup -- same
 * "غير معروف" fallback convention used by getSalesForExport/getCashierRanking/listOperations.
 */
export async function getShiftsForReport(supabase: Client, startDate: Date, endDate: Date): Promise<ShiftWithCashierName[]> {
  const { data: shiftsData, error } = await supabase
    .from("shifts")
    .select("*")
    .gte("opened_at", startDate.toISOString())
    .lte("opened_at", endDate.toISOString())
    .order("opened_at", { ascending: false });

  if (error) throw error;
  const shifts = shiftsData ?? [];
  if (shifts.length === 0) return [];

  const cashierIds = Array.from(new Set(shifts.map((shift) => shift.cashier_id).filter((id): id is string => id !== null)));
  const nameById = new Map<string, string>();
  if (cashierIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id, full_name").in("id", cashierIds);
    if (profilesError) throw profilesError;
    (profiles ?? []).forEach((profile) => nameById.set(profile.id, profile.full_name));
  }

  return shifts.map((shift) => ({
    ...shift,
    cashierName: shift.cashier_id ? (nameById.get(shift.cashier_id) ?? "غير معروف") : "غير معروف",
  }));
}
```

Move the `import type { ShiftWithCashierName } from "@/types/shifts";` line up to the top of the file next to the existing `import type { Shift } from "@/types/shifts";` import instead of leaving it inline — combine into one import statement: `import type { Shift, ShiftWithCashierName } from "@/types/shifts";`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/shifts.service.report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full shifts service test suite, typecheck, and lint**

Run: `npx vitest run services/shifts.service.test.ts services/shifts.service.expectedAmount.test.ts services/shifts.service.close.test.ts services/shifts.service.report.test.ts && npm run typecheck && npm run lint`
Expected: all pass, no errors.

- [ ] **Step 6: Commit**

```bash
git add services/shifts.service.ts services/shifts.service.report.test.ts
git commit -m "feat: add getShiftsForReport to shifts service"
```

---

### Task 6: `customers.service.ts` — attribute debt payments to a cashier

**Files:**
- Modify: `services/customers.service.ts`
- Modify: `services/customers.service.test.ts`

**Interfaces:**
- Consumes: `customer_transactions.cashier_id` column (Task 1).
- Produces: `recordPayment` now writes the already-received `actorId` parameter into the row's new `cashier_id` column (no signature change). Task 3's `getCashDebtPaymentsSum` reads this column.

- [ ] **Step 1: Update the existing test to expect `cashier_id`**

In `services/customers.service.test.ts`, update `INSERTED_TRANSACTION` to include the new field:

```typescript
const INSERTED_TRANSACTION: CustomerTransaction = {
  id: "txn-1",
  customer_id: "customer-1",
  type: "payment",
  amount: 5000,
  sale_id: null,
  cashier_id: "user-1",
  note: null,
  store_id: "store-1",
  created_at: "",
};
```

Then update the happy-path test's `insertSpy` assertion (the `it("inserts a payment transaction and logs customer_payment_recorded on the happy path"...)` test) to add `cashier_id: "user-1"`:

```typescript
    expect(insertSpy).toHaveBeenCalledWith({
      customer_id: "customer-1",
      type: "payment",
      amount: 5000,
      note: null,
      store_id: "store-1",
      cashier_id: "user-1",
    });
```

- [ ] **Step 2: Run the tests to verify the assertion fails**

Run: `npx vitest run services/customers.service.test.ts`
Expected: FAIL on the happy-path test — the current `insertSpy` call doesn't include `cashier_id`.

- [ ] **Step 3: Update `recordPayment` in `services/customers.service.ts`**

Find the `.insert({...})` call inside `recordPayment` and add `cashier_id: actorId`:

```typescript
  const { data, error } = await supabase
    .from("customer_transactions")
    .insert({
      customer_id: input.customerId,
      type: "payment",
      amount: input.amount,
      note: input.note ?? null,
      store_id: storeId,
      cashier_id: actorId,
    })
    .select()
    .single();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/customers.service.test.ts`
Expected: PASS (all tests in this file).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/customers.service.ts services/customers.service.test.ts
git commit -m "feat: attribute customer debt payments to the collecting cashier"
```

---

### Task 7: `useShift` hook

**Files:**
- Create: `hooks/useShift.ts`

**Interfaces:**
- Consumes: `getOpenShift`, `openShift`, `closeShift` from `@/services/shifts.service` (Tasks 2, 4).
- Produces: `useShift({ cashierId, storeId }): { shift: Shift | null; isLoading: boolean; isSubmitting: boolean; error: string | null; open: (openingBalance: number) => Promise<void>; close: (countedAmount: number) => Promise<void> }`. Task 8 (`ShiftGate`) and Task 9 (`CloseShiftModal`) both consume this shape via `app/(dashboard)/pos/page.tsx`.

This repo has no automated tests for hooks (confirmed: `hooks/` has zero `*.test.ts` files today — hooks are thin wrappers verified through the components that use them). This task is verified by typecheck/lint plus the manual POS smoke test at the end of Task 9.

- [ ] **Step 1: Write the hook**

Create `hooks/useShift.ts`:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { closeShift, getOpenShift, openShift } from "@/services/shifts.service";
import type { Shift } from "@/types/shifts";

interface UseShiftOptions {
  cashierId: string | null;
  storeId: string | null;
}

/** Loads the cashier's currently open shift (if any) and exposes open/close actions. Mirrors the shape of usePOS's isCheckingOut/checkout pairing. */
export function useShift({ cashierId, storeId }: UseShiftOptions) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cashierId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    const supabase = createClient();

    getOpenShift(supabase, cashierId)
      .then((row) => {
        if (!cancelled) setShift(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "تعذر تحميل الوردية");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cashierId]);

  const open = useCallback(
    async (openingBalance: number) => {
      if (!cashierId || !storeId) return;
      setError(null);
      setIsSubmitting(true);
      try {
        const supabase = createClient();
        const row = await openShift(supabase, { openingBalance }, cashierId, storeId);
        setShift(row);
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر فتح الوردية");
      } finally {
        setIsSubmitting(false);
      }
    },
    [cashierId, storeId],
  );

  const close = useCallback(
    async (countedAmount: number) => {
      if (!shift || !storeId) return;
      setError(null);
      setIsSubmitting(true);
      try {
        const supabase = createClient();
        await closeShift(supabase, { shiftId: shift.id, countedAmount }, cashierId, storeId, false);
        setShift(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر إغلاق الوردية");
      } finally {
        setIsSubmitting(false);
      }
    },
    [shift, storeId, cashierId],
  );

  return { shift, isLoading, isSubmitting, error, open, close };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. (`useShift` isn't imported anywhere yet, so no runtime to check.)

- [ ] **Step 3: Commit**

```bash
git add hooks/useShift.ts
git commit -m "feat: add useShift hook"
```

---

### Task 8: `ShiftGate` — block POS until a shift is open

**Files:**
- Create: `components/features/pos/ShiftGate.tsx`
- Modify: `app/(dashboard)/pos/page.tsx`

**Interfaces:**
- Consumes: `useShift`'s `shift`/`isLoading`/`isSubmitting`/`error`/`open` (Task 7), `Shift` type (Task 1), existing `Modal`/`Input`/`Button` UI components.
- Produces: `<ShiftGate>` component rendered at the top of the POS page's JSX tree.

- [ ] **Step 1: Write `ShiftGate.tsx`**

Create `components/features/pos/ShiftGate.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Shift } from "@/types/shifts";

interface ShiftGateProps {
  shift: Shift | null;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  onOpen: (openingBalance: number) => Promise<void>;
}

/**
 * Blocks POS usage until the cashier has an open shift. Renders nothing
 * once one exists (or while still loading). Otherwise renders a
 * non-dismissable Modal (onClose is a no-op, so Escape/backdrop-click
 * can't close it) asking for the opening cash balance.
 */
export function ShiftGate({ shift, isLoading, isSubmitting, error, onOpen }: ShiftGateProps) {
  const [openingBalance, setOpeningBalance] = useState("");

  if (isLoading || shift) return null;

  const balanceNumber = Number(openingBalance);
  const isValid = openingBalance !== "" && Number.isFinite(balanceNumber) && balanceNumber >= 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid) return;
    await onOpen(balanceNumber);
  }

  return (
    <Modal open onClose={() => {}} title="فتح وردية جديدة">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">أدخل الرصيد الافتتاحي بالصندوق قبل بدء البيع.</p>
        <Input
          label="الرصيد الافتتاحي"
          type="number"
          min={0}
          step="0.01"
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          autoFocus
          required
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={!isValid || isSubmitting}>
          {isSubmitting ? "جارٍ الفتح..." : "فتح الوردية والبدء بالبيع"}
        </Button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire it into `app/(dashboard)/pos/page.tsx`**

Add these imports near the top of `app/(dashboard)/pos/page.tsx` (alongside the existing `Modal`/`Button`/`Input` imports):

```typescript
import { useAuth } from "@/context/AuthContext";
import { useShift } from "@/hooks/useShift";
import { ShiftGate } from "@/components/features/pos/ShiftGate";
```

Inside the `POSPage` component, right after the existing `const { isMuted, toggle: toggleMuted } = useSoundSettings();` line, add:

```typescript
  const { user, storeId } = useAuth();
  const { shift, isLoading: isShiftLoading, isSubmitting: isShiftSubmitting, error: shiftError, open: openShiftAction } = useShift({
    cashierId: user?.id ?? null,
    storeId,
  });
```

Right before the component's final closing `</div>` (the outermost wrapper `<div className="-m-3 flex h-[calc(100vh-4rem-4.25rem)]...">`), add the gate as the last child, right after the existing `<Modal>` blocks:

```typescript
      <ShiftGate shift={shift} isLoading={isShiftLoading} isSubmitting={isShiftSubmitting} error={shiftError} onOpen={openShiftAction} />
```

- [ ] **Step 3: Typecheck, lint, and full test suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: no errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/features/pos/ShiftGate.tsx "app/(dashboard)/pos/page.tsx"
git commit -m "feat: block POS with a shift-opening gate until a cash balance is entered"
```

---

### Task 9: `CloseShiftModal` — close the shift from the POS header

**Files:**
- Create: `components/features/pos/CloseShiftModal.tsx`
- Modify: `app/(dashboard)/pos/page.tsx`

**Interfaces:**
- Consumes: `useShift`'s `shift`/`isSubmitting`/`error`/`close` (Task 7), `calculateExpectedAmount` (Task 3), `Shift` type (Task 1), existing `Modal`/`Input`/`Button` UI components, `formatCurrency` (`lib/utils.ts`).
- Produces: `<CloseShiftModal>` component plus a "إغلاق الوردية" button in the POS header.

- [ ] **Step 1: Write `CloseShiftModal.tsx`**

Create `components/features/pos/CloseShiftModal.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateExpectedAmount } from "@/services/shifts.service";
import { formatCurrency } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Shift } from "@/types/shifts";

interface CloseShiftModalProps {
  shift: Shift;
  open: boolean;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (countedAmount: number) => Promise<void>;
}

/**
 * Shows a live-computed expected cash amount (recomputed fresh each time
 * this opens -- not trusted from any earlier render), then asks the
 * cashier to enter what they actually counted. The real difference is
 * computed again, atomically, inside closeShift itself at submit time --
 * this preview is for the cashier's benefit, not the source of truth.
 */
export function CloseShiftModal({ shift, open, isSubmitting, error, onClose, onConfirm }: CloseShiftModalProps) {
  const [expectedAmount, setExpectedAmount] = useState<number | null>(null);
  const [countedAmount, setCountedAmount] = useState("");

  useEffect(() => {
    if (!open) return;
    setExpectedAmount(null);
    setCountedAmount("");
    const supabase = createClient();
    calculateExpectedAmount(supabase, shift, new Date()).then(setExpectedAmount);
  }, [open, shift]);

  const countedNumber = Number(countedAmount);
  const isValid = countedAmount !== "" && Number.isFinite(countedNumber) && countedNumber >= 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid) return;
    await onConfirm(countedNumber);
  }

  return (
    <Modal open={open} onClose={onClose} title="إغلاق الوردية">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          المبلغ المتوقع بالصندوق:{" "}
          <span className="font-semibold text-gray-900">
            {expectedAmount === null ? "جارٍ الحساب..." : formatCurrency(expectedAmount)}
          </span>
        </p>
        <Input
          label="المبلغ المعدود فعلياً"
          type="number"
          min={0}
          step="0.01"
          value={countedAmount}
          onChange={(event) => setCountedAmount(event.target.value)}
          autoFocus
          required
        />
        {isValid && expectedAmount !== null ? (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            الفرق: {formatCurrency(countedNumber - expectedAmount)}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" disabled={!isValid || isSubmitting}>
            {isSubmitting ? "جارٍ الإغلاق..." : "تأكيد إغلاق الوردية"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire it into `app/(dashboard)/pos/page.tsx`**

Add the import next to `ShiftGate`'s:

```typescript
import { CloseShiftModal } from "@/components/features/pos/CloseShiftModal";
```

Right after the `useShift` call added in Task 8, destructure `close` too and add local state for the modal:

```typescript
  const { shift, isLoading: isShiftLoading, isSubmitting: isShiftSubmitting, error: shiftError, open: openShiftAction, close: closeShiftAction } = useShift({
    cashierId: user?.id ?? null,
    storeId,
  });
  const [isCloseShiftOpen, setIsCloseShiftOpen] = useState(false);
```

(Note: this replaces the `useShift` destructuring line from Task 8 with the version above that also pulls out `close`.)

In the `<header>` block, right before the existing sound-toggle `<button>` (the one with `onClick={toggleMuted}`), add a close-shift button that only shows once a shift is open:

```typescript
          {shift ? (
            <button
              type="button"
              onClick={() => setIsCloseShiftOpen(true)}
              className="shrink-0 rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100"
            >
              إغلاق الوردية
            </button>
          ) : null}
```

Right after the `<ShiftGate .../>` line added in Task 8, render the close modal (only once a shift exists, since `CloseShiftModal` requires a non-null `shift` prop):

```typescript
      {shift ? (
        <CloseShiftModal
          shift={shift}
          open={isCloseShiftOpen}
          isSubmitting={isShiftSubmitting}
          error={shiftError}
          onClose={() => setIsCloseShiftOpen(false)}
          onConfirm={async (counted) => {
            await closeShiftAction(counted);
            setIsCloseShiftOpen(false);
          }}
        />
      ) : null}
```

- [ ] **Step 3: Typecheck, lint, and full test suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: no errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/features/pos/CloseShiftModal.tsx "app/(dashboard)/pos/page.tsx"
git commit -m "feat: add close-shift button and modal to POS header"
```

---

### Task 10: Admin "الورديات" report page

**Files:**
- Create: `app/(dashboard)/shifts/page.tsx`
- Create: `components/features/shifts/ShiftsList.tsx`
- Modify: `components/shared/navLinks.tsx`

**Interfaces:**
- Consumes: `getShiftsForReport` (Task 5), `closeShift` (Task 4, called with `isForced = true`), `ShiftWithCashierName` type (Task 1), existing `RangeDatePicker`/`Button`/`BackToSettingsLink` components.
- Produces: `/shifts` route, reachable from `/settings` for admins only.

- [ ] **Step 1: Add the nav entry in `components/shared/navLinks.tsx`**

Change the lucide-react import line at the top to add `Wallet`:

```typescript
import { ShoppingCart, Package, Settings as SettingsIcon, BarChart3, Users, Archive as ArchiveIcon, Landmark, Store, Truck, Wallet, type LucideIcon } from "lucide-react";
```

Add a new entry to `SETTINGS_LINKS` (after the `"/sales"` entry):

```typescript
export const SETTINGS_LINKS: SettingsLink[] = [
  { href: "/sales", label: "المبيعات", adminOnly: true, icon: BarChart3 },
  { href: "/shifts", label: "الورديات", adminOnly: true, icon: Wallet },
  { href: "/customers", label: "الزبائن", adminOnly: false, icon: Landmark },
  { href: "/archive", label: "الأرشيف", adminOnly: false, icon: ArchiveIcon },
  { href: "/employees", label: "الموظفون", adminOnly: true, icon: Users },
  { href: "/suppliers", label: "الموردون", adminOnly: true, icon: Truck },
  { href: "/settings/store", label: "بيانات المتجر", adminOnly: true, icon: Store },
];
```

Add `"/shifts"` to `SETTINGS_PATHS`:

```typescript
const SETTINGS_PATHS = ["/settings", "/sales", "/shifts", "/customers", "/archive", "/employees", "/settings/store", "/suppliers"];
```

- [ ] **Step 2: Write `ShiftsList.tsx`**

Create `components/features/shifts/ShiftsList.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getShiftsForReport, closeShift } from "@/services/shifts.service";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import { RangeDatePicker } from "@/components/features/sales/RangeDatePicker";
import type { CustomRange, PresetDays } from "@/components/features/sales/RangeDatePicker";
import { Button } from "@/components/ui/Button";
import type { ShiftWithCashierName } from "@/types/shifts";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeForPreset(days: PresetDays): CustomRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

function toReportRange(range: CustomRange): { startDate: Date; endDate: Date } {
  const startDate = new Date(range.startDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(range.endDate);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

/** Admin-only list of shifts in a date range, with a force-close action on any still-open row. */
export function ShiftsList() {
  const { user, storeId } = useAuth();
  const [preset, setPreset] = useState<PresetDays | null>(7);
  const [customRange, setCustomRange] = useState<CustomRange>(rangeForPreset(7));
  const [shifts, setShifts] = useState<ShiftWithCashierName[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingShiftId, setClosingShiftId] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { startDate, endDate } = toReportRange(customRange);
      const rows = await getShiftsForReport(supabase, startDate, endDate);
      setShifts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الورديات");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customRange.startDate, customRange.endDate]);

  function handlePresetChange(days: PresetDays) {
    setPreset(days);
    setCustomRange(rangeForPreset(days));
  }

  function handleCustomRangeChange(range: CustomRange) {
    setPreset(null);
    setCustomRange(range);
  }

  async function handleForceClose(shiftId: string) {
    if (!storeId) return;
    setClosingShiftId(shiftId);
    try {
      const supabase = createClient();
      await closeShift(supabase, { shiftId, countedAmount: null }, user?.id ?? null, storeId, true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إغلاق الوردية");
    } finally {
      setClosingShiftId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <RangeDatePicker
        preset={preset}
        customRange={customRange}
        onPresetChange={handlePresetChange}
        onCustomRangeChange={handleCustomRangeChange}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {isLoading ? (
        <p className="text-sm text-gray-500">جارٍ التحميل...</p>
      ) : shifts.length === 0 ? (
        <p className="text-sm text-gray-500">لا توجد ورديات في هذه الفترة</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <div
              key={shift.id}
              className={cn(
                "rounded-xl border p-3",
                shift.status === "open"
                  ? "border-amber-300 bg-amber-50"
                  : shift.forced_closed_by
                    ? "border-purple-300 bg-purple-50"
                    : shift.difference !== null && shift.difference !== 0
                      ? "border-red-300 bg-red-50"
                      : "border-gray-200 bg-white",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-900">{shift.cashierName}</span>
                <span className="text-xs text-gray-500">{formatDateTime(shift.opened_at)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-600 sm:grid-cols-4">
                <span>افتتاحي: {formatCurrency(shift.opening_balance)}</span>
                <span>متوقع: {shift.expected_amount === null ? "—" : formatCurrency(shift.expected_amount)}</span>
                <span>
                  معدود:{" "}
                  {shift.forced_closed_by
                    ? "لم يُعد (إغلاق قسري)"
                    : shift.counted_amount === null
                      ? "—"
                      : formatCurrency(shift.counted_amount)}
                </span>
                <span className={shift.difference !== null && shift.difference !== 0 ? "font-semibold text-red-700" : ""}>
                  الفرق: {shift.difference === null ? "—" : formatCurrency(shift.difference)}
                </span>
              </div>
              {shift.status === "open" ? (
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={closingShiftId === shift.id}
                    onClick={() => handleForceClose(shift.id)}
                  >
                    {closingShiftId === shift.id ? "جارٍ الإغلاق..." : "إغلاق قسري"}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Confirm `formatDateTime` and `cn` are exported from `lib/utils.ts`**

Run: `grep -n "^export function formatDateTime\|^export function cn" lib/utils.ts`
Expected: both lines print (they already exist — used elsewhere in this repo, e.g. `SalesExportModal.tsx`/`Modal.tsx`). If either is missing, stop and re-check the import path before continuing.

- [ ] **Step 4: Write `app/(dashboard)/shifts/page.tsx`**

Create `app/(dashboard)/shifts/page.tsx`:

```typescript
"use client";

import { useAuth } from "@/context/AuthContext";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";
import { ShiftsList } from "@/components/features/shifts/ShiftsList";

export default function ShiftsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لتقرير الورديات.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackToSettingsLink />
      <h1 className="text-xl font-bold text-gray-900">الورديات</h1>
      <ShiftsList />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint, full test suite, and build**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: no errors, all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/shifts/page.tsx components/features/shifts/ShiftsList.tsx components/shared/navLinks.tsx
git commit -m "feat: add admin shifts report page with force-close"
```

---

## After all tasks: manual verification + live migration

This app authenticates against the live client's real Supabase project (`klctindutdkvsmnsegwy`) — there is no throwaway test store. Before considering this feature done:

1. Apply migration `00000000000018_cash_drawer_shifts.sql` to the live database (via the Management API SQL endpoint — the `supabase db push`/`link` CLI path is broken for this project, see prior sessions' notes) — **ask the user for explicit confirmation naming the exact migration before running it.**
2. Manually smoke-test on the live app: log in as a cashier with no open shift, confirm the blocking modal appears and POS is unusable until submitted; make a cash sale, a credit sale, and (if a customer with debt exists) a debt payment; close the shift and confirm the expected amount matches by hand; confirm a forced close from `/shifts` works and is visually distinct (purple) from a normal difference (red) or a clean close (gray); confirm a cashier account cannot see the "الورديات" nav item or load `/shifts` directly.
3. Push to GitHub `main` — **ask the user for explicit confirmation naming the push before running it**, per this repo's established push-confirmation convention.
