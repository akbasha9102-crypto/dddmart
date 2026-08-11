# Stock Reconciliation (تسوية الجرد) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin correct a product's stock quantity to match a physical count (shortage or overage), with a permanent audit trail and the resulting shrinkage loss visible in daily/period profit reporting.

**Architecture:** Mirrors this repo's existing damage-tracking feature exactly — a new append-only, store-scoped audit table (`stock_reconciliations`), a service function that atomically adjusts stock via the existing `adjust_product_stock` RPC and logs the action, an admin-only modal form wired into the same two product-list surfaces (`StockTable`, `CategoryProductList`), and the resulting loss netted into the same 5 sales-reporting functions damage loss already flows through.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (Postgres + RLS), Vitest.

## Global Constraints

- Match this repo's existing conventions exactly: services take a `SupabaseClient<Database>` as their first argument, all user-facing strings and error messages are Arabic, DB columns are `snake_case`, TS fields are `camelCase`.
- Every new DB write includes `store_id`, and every new RLS policy uses `store_id = current_store_id()` (the function already exists from migration `00000000000012`) — never `using (true)`.
- Admin-only UI actions are gated with `isAdminRole(role)` from `@/lib/employees/adminCheck`, matching how "استلام"/"تالف" are already gated in `StockTable.tsx`/`CategoryProductList.tsx`.
- Do **not** apply the new migration to the live Supabase project — commit the `.sql` file only. Applying it live requires a separate, explicit user confirmation (this project's established convention — see prior migrations).
- Do **not** run `git push` — commit locally only at the end of each task. Pushing to `main` requires its own explicit user confirmation.
- Before any commit that touches `.ts`/`.tsx` files, run `npm run typecheck && npm run lint && npm run test && npm run build` and confirm all four pass.
- This repo has no `*.test.tsx` files — UI components (forms, table rows, pages) are not unit-tested here; only `services/*.ts` get Vitest coverage. Don't introduce component tests that break that convention.

---

### Task 1: Database migration + generated types for `stock_reconciliations`

**Files:**
- Create: `supabase/migrations/00000000000014_stock_reconciliation.sql`
- Modify: `types/database.types.ts`
- Create: `types/reconciliations.ts`

**Interfaces:**
- Produces: `Database["public"]["Tables"]["stock_reconciliations"]` (`Row`/`Insert`/`Update`), `OperationActionType` gains `"stock_reconciled"`, `StockReconciliation`/`StockReconciliationInsert` types — every later task imports these.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00000000000014_stock_reconciliation.sql`:

```sql
-- Stock Reconciliation (تسوية الجرد).
--
-- Append-only audit table (no update/delete policy) — a reconciliation,
-- once recorded, is corrected only by another reconciliation, never
-- edited. previous_quantity/counted_quantity/unit/cost_price are
-- snapshots at reconciliation time (same rationale as
-- stock_damages.cost_price). difference = counted_quantity -
-- previous_quantity (negative = shortage, positive = overage).
-- loss_value is only populated for a shortage (abs(difference) *
-- cost_price) — an overage corrects the quantity but is never treated
-- as profit, so loss_value stays 0 for it.
create table stock_reconciliations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  unit text not null,
  previous_quantity integer not null,
  counted_quantity integer not null check (counted_quantity >= 0),
  difference integer not null,
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  loss_value numeric(12, 2) not null default 0 check (loss_value >= 0),
  reason text,
  actor_id uuid references profiles (id) on delete set null,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);

create index stock_reconciliations_created_at_idx on stock_reconciliations (created_at);
create index stock_reconciliations_product_id_idx on stock_reconciliations (product_id);
create index stock_reconciliations_store_id_idx on stock_reconciliations (store_id);

alter table stock_reconciliations enable row level security;

create policy "authenticated read stock_reconciliations" on stock_reconciliations for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert stock_reconciliations" on stock_reconciliations for insert to authenticated
  with check (store_id = current_store_id());
```

- [ ] **Step 2: Add the action type and table types to `types/database.types.ts`**

In `types/database.types.ts`, change:

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
  | "customer_created"
  | "customer_updated"
  | "customer_archived"
  | "customer_payment_recorded";
```

to:

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
```

Then, immediately after the `stock_damages: { ... };` block (the one with `Relationships` referencing `stock_damages_product_id_fkey`/`stock_damages_actor_id_fkey`), insert a new table block:

```ts
      stock_reconciliations: {
        Row: {
          id: string;
          product_id: string | null;
          product_name: string;
          unit: string;
          previous_quantity: number;
          counted_quantity: number;
          difference: number;
          cost_price: number;
          loss_value: number;
          reason: string | null;
          actor_id: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          product_name: string;
          unit: string;
          previous_quantity: number;
          counted_quantity: number;
          difference: number;
          cost_price: number;
          loss_value?: number;
          reason?: string | null;
          actor_id?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          product_name?: string;
          unit?: string;
          previous_quantity?: number;
          counted_quantity?: number;
          difference?: number;
          cost_price?: number;
          loss_value?: number;
          reason?: string | null;
          actor_id?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_reconciliations_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_reconciliations_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 3: Create `types/reconciliations.ts`**

```ts
import type { Database } from "./database.types";

export type StockReconciliation = Database["public"]["Tables"]["stock_reconciliations"]["Row"];
export type StockReconciliationInsert = Database["public"]["Tables"]["stock_reconciliations"]["Insert"];
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (no errors — nothing consumes the new types yet, so this just confirms the type additions themselves are syntactically valid).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00000000000014_stock_reconciliation.sql types/database.types.ts types/reconciliations.ts
git commit -m "Add stock_reconciliations table, migration, and types"
```

---

### Task 2: `services/reconciliations.service.ts`

**Files:**
- Create: `services/reconciliations.service.ts`
- Test: `services/reconciliations.service.test.ts`

**Interfaces:**
- Consumes: `StockReconciliation` from `@/types/reconciliations` (Task 1), `logOperation` from `@/services/archive.service` (existing, signature `logOperation(supabase, { userId, actionType, entityType, entityId?, description, storeId })`), the existing `adjust_product_stock` RPC (`supabase.rpc("adjust_product_stock", { p_product_id, p_delta })` → `Product[] | null`).
- Produces: `recordReconciliation(supabase, params: RecordReconciliationParams, actorId: string | null, storeId: string): Promise<StockReconciliation>` where `RecordReconciliationParams = { productId: string; productName: string; countedQuantity: number; reason: string | null }` — Tasks 4 (form) and any future caller use this exact signature.

- [ ] **Step 1: Write the failing tests**

Create `services/reconciliations.service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordReconciliation } from "./reconciliations.service";
import type { Database } from "@/types/database.types";
import type { StockReconciliation } from "@/types/reconciliations";
import type { Product } from "@/types/product";

const PRODUCT_FIELDS = { quantity: 20, cost_price: 1.5, unit: "قطعة" };

const INSERTED_RECONCILIATION: StockReconciliation = {
  id: "reconciliation-1",
  product_id: "product-1",
  product_name: "علبة علك",
  unit: "قطعة",
  previous_quantity: 20,
  counted_quantity: 18,
  difference: -2,
  cost_price: 1.5,
  loss_value: 3,
  reason: "جرد دوري",
  actor_id: "user-1",
  store_id: "store-1",
  created_at: "",
};

/**
 * Hand-rolled fake covering the exact chains recordReconciliation calls:
 * products.select().eq().maybeSingle() (fresh stock snapshot), rpc()
 * (adjust_product_stock), stock_reconciliations.insert().select().single(),
 * and operations_log.insert() (logOperation). Deliberately minimal,
 * matching the other fakes in this repo (see damages.service.test.ts).
 */
function createFakeSupabase(options: {
  productFields?: { quantity: number; cost_price: number; unit: string } | null;
  rpcData?: Product[] | null;
}): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => ({
    data: options.rpcData ?? [{ ...PRODUCT_FIELDS } as Product],
    error: null,
  }));
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: INSERTED_RECONCILIATION, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "products") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.productFields === undefined ? PRODUCT_FIELDS : options.productFields,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "stock_reconciliations") return { insert: insertSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, insertSpy, logInsertSpy };
}

const BASE_PARAMS = {
  productId: "product-1",
  productName: "علبة علك",
  reason: "جرد دوري",
};

describe("recordReconciliation", () => {
  it("throws and inserts nothing when the product can't be found", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({ productFields: null });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1"),
    ).rejects.toThrow("تعذر العثور على المنتج");
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("throws and inserts nothing when the counted quantity equals the current quantity", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({});

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 20 }, "user-1", "store-1"),
    ).rejects.toThrow("لا يوجد فرق لتسجيله");
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("computes a negative difference and a positive loss_value for a shortage", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({});

    await recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1");

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", { p_product_id: "product-1", p_delta: -2 });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        previous_quantity: 20,
        counted_quantity: 18,
        difference: -2,
        loss_value: 3,
        store_id: "store-1",
      }),
    );
  });

  it("computes a positive difference with zero loss_value for an overage", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({});

    await recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 23 }, "user-1", "store-1");

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", { p_product_id: "product-1", p_delta: 3 });
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ difference: 3, loss_value: 0 }));
  });

  it("throws when the RPC returns no rows (adjustment guard rejected it)", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ rpcData: [] });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1"),
    ).rejects.toThrow("تعذر تحديث المخزون");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("logs a stock_reconciled operation after a successful adjustment", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({});

    await recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1");

    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "stock_reconciled", user_id: "user-1", store_id: "store-1" }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run services/reconciliations.service.test.ts`
Expected: FAIL — `Cannot find module './reconciliations.service'` (file doesn't exist yet).

- [ ] **Step 3: Implement `services/reconciliations.service.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { StockReconciliation } from "@/types/reconciliations";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

export interface RecordReconciliationParams {
  productId: string;
  productName: string;
  countedQuantity: number;
  reason: string | null;
}

/**
 * Corrects a product's stock to match a physical count. Re-fetches the
 * product's quantity/cost_price/unit fresh (not trusting a value the UI
 * opened with — stock can move between opening the form and submitting),
 * computes difference = countedQuantity - freshQuantity, and applies it
 * atomically via adjust_product_stock (which supports both directions,
 * unlike decrementStock). loss_value is only positive for a shortage
 * (difference < 0); an overage corrects the quantity but is never valued
 * as profit.
 */
export async function recordReconciliation(
  supabase: Client,
  params: RecordReconciliationParams,
  actorId: string | null,
  storeId: string,
): Promise<StockReconciliation> {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("quantity, cost_price, unit")
    .eq("id", params.productId)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error("تعذر العثور على المنتج");

  const previousQuantity = product.quantity;
  const difference = params.countedQuantity - previousQuantity;
  if (difference === 0) {
    throw new Error("لا يوجد فرق لتسجيله");
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("adjust_product_stock", {
    p_product_id: params.productId,
    p_delta: difference,
  });
  if (rpcError) throw rpcError;
  const updated = rpcData?.[0] ?? null;
  if (!updated) {
    throw new Error("تعذر تحديث المخزون — حاول مرة أخرى");
  }

  const lossValue = difference < 0 ? Math.abs(difference) * product.cost_price : 0;

  const { data: inserted, error: insertError } = await supabase
    .from("stock_reconciliations")
    .insert({
      product_id: params.productId,
      product_name: params.productName,
      unit: product.unit,
      previous_quantity: previousQuantity,
      counted_quantity: params.countedQuantity,
      difference,
      cost_price: product.cost_price,
      loss_value: lossValue,
      reason: params.reason,
      actor_id: actorId,
      store_id: storeId,
    })
    .select()
    .single();
  if (insertError) throw insertError;

  const directionLabel = difference < 0 ? `نقص ${Math.abs(difference)}` : `زيادة ${difference}`;
  await logOperation(supabase, {
    userId: actorId,
    actionType: "stock_reconciled",
    entityType: "stock",
    entityId: params.productId,
    description: `تمت تسوية "${params.productName}": من ${previousQuantity} إلى ${params.countedQuantity} (${directionLabel})${
      params.reason ? ` — السبب: ${params.reason}` : ""
    }`,
    storeId,
  });

  return inserted;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run services/reconciliations.service.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/reconciliations.service.ts services/reconciliations.service.test.ts
git commit -m "Add reconciliations.service with recordReconciliation"
```

---

### Task 3: `StockReconciliationForm.tsx`

**Files:**
- Create: `components/features/inventory/StockReconciliationForm.tsx`

**Interfaces:**
- Consumes: `recordReconciliation` from `@/services/reconciliations.service` (Task 2), `Product` from `@/types/product`, `useAuth()` (existing, returns `{ user, storeId, role }`), `formatCurrency` from `@/lib/utils`, `Input`/`Button` from `@/components/ui`.
- Produces: `<StockReconciliationForm product={Product} onSaved={() => void} onCancel={() => void} />` — Task 5's inventory page modal renders this exact component.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordReconciliation } from "@/services/reconciliations.service";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface StockReconciliationFormProps {
  product: Product;
  onSaved: () => void;
  onCancel: () => void;
}

const REASON_PRESETS = ["جرد دوري", "اشتباه سرقة", "خطأ إدخال سابق", "أخرى"] as const;

/** Lets an admin correct a product's stock to match a physical count — the count can be lower (shortage/theft) or higher (overage) than the system quantity. Mirrors DamageStockForm's shape. */
export function StockReconciliationForm({ product, onSaved, onCancel }: StockReconciliationFormProps) {
  const { user, storeId } = useAuth();
  const [countedQuantity, setCountedQuantity] = useState("");
  const [reasonPreset, setReasonPreset] = useState<(typeof REASON_PRESETS)[number]>(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const countedNumber = Number(countedQuantity);
  const isCountValid = countedQuantity !== "" && Number.isInteger(countedNumber) && countedNumber >= 0;
  const difference = isCountValid ? countedNumber - product.quantity : 0;
  const hasDifference = isCountValid && difference !== 0;
  const estimatedLoss = difference < 0 ? Math.abs(difference) * product.cost_price : 0;

  const finalReason = useMemo(
    () => (reasonPreset === "أخرى" ? customReason.trim() || null : reasonPreset),
    [reasonPreset, customReason],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!Number.isInteger(countedNumber) || countedNumber < 0) {
      setError("الكمية الفعلية يجب أن تكون عدداً صحيحاً صفر أو أكبر");
      return;
    }
    if (countedNumber === product.quantity) {
      setError("لا يوجد فرق لتسجيله");
      return;
    }

    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      await recordReconciliation(
        supabase,
        {
          productId: product.id,
          productName: product.name,
          countedQuantity: countedNumber,
          reason: finalReason,
        },
        user?.id ?? null,
        storeId,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل التسوية");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        الكمية المسجلة بالنظام: <span className="font-semibold text-gray-900">{product.quantity} {product.unit}</span>
      </p>

      <Input
        label={`الكمية الفعلية بعد الجرد (${product.unit})`}
        type="number"
        min={0}
        step={1}
        value={countedQuantity}
        onChange={(event) => setCountedQuantity(event.target.value)}
        required
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="reconciliation-reason" className="text-sm font-medium text-gray-700">
          السبب
        </label>
        <select
          id="reconciliation-reason"
          value={reasonPreset}
          onChange={(event) => setReasonPreset(event.target.value as (typeof REASON_PRESETS)[number])}
          className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        >
          {REASON_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </div>

      {reasonPreset === "أخرى" ? (
        <Input
          label="وضّح السبب"
          type="text"
          value={customReason}
          onChange={(event) => setCustomReason(event.target.value)}
        />
      ) : null}

      {hasDifference ? (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          الفرق: {difference > 0 ? `زيادة ${difference}` : `نقص ${Math.abs(difference)}`}
          {estimatedLoss > 0 ? ` — الخسارة التقديرية: ${formatCurrency(estimatedLoss)}` : ""}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" disabled={isSaving || !hasDifference}>
          {isSaving ? "جارٍ الحفظ..." : "تسجيل التسوية"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/features/inventory/StockReconciliationForm.tsx
git commit -m "Add StockReconciliationForm"
```

---

### Task 4: Wire the reconciliation action into `StockTable.tsx` and `CategoryProductList.tsx`

**Files:**
- Modify: `components/features/inventory/StockTable.tsx`
- Modify: `components/features/inventory/CategoryProductList.tsx`

**Interfaces:**
- Produces: both components gain an `onReconcileStock: (product) => void` prop, called from a new admin-only "تسوية" button — Task 5's inventory page passes a handler for this prop.

- [ ] **Step 1: Modify `StockTable.tsx`**

Change the import line:

```tsx
import { PackagePlus, PackageX } from "lucide-react";
```

to:

```tsx
import { PackagePlus, PackageX, ClipboardCheck } from "lucide-react";
```

Change the props interface:

```tsx
interface StockTableProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onReceiveStock: (product: Product) => void;
  onDamageStock: (product: Product) => void;
}

export function StockTable({ products, onEdit, onDelete, onReceiveStock, onDamageStock }: StockTableProps) {
```

to:

```tsx
interface StockTableProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onReceiveStock: (product: Product) => void;
  onDamageStock: (product: Product) => void;
  onReconcileStock: (product: Product) => void;
}

export function StockTable({ products, onEdit, onDelete, onReceiveStock, onDamageStock, onReconcileStock }: StockTableProps) {
```

Add a new button right after the existing "تالف" button (after its closing `) : null}`):

```tsx
                {isAdminRole(role) ? (
                  <button
                    type="button"
                    onClick={() => onDamageStock(product)}
                    aria-label="تسجيل تلف"
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-orange-700 hover:bg-orange-50"
                  >
                    <PackageX className="h-4 w-4" />
                    تالف
                  </button>
                ) : null}
                {isAdminRole(role) ? (
                  <button
                    type="button"
                    onClick={() => onReconcileStock(product)}
                    aria-label="تسوية المخزون"
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-indigo-700 hover:bg-indigo-50"
                  >
                    <ClipboardCheck className="h-4 w-4" />
                    تسوية
                  </button>
                ) : null}
```

- [ ] **Step 2: Modify `CategoryProductList.tsx`**

Change the import line:

```tsx
import { PackagePlus, PackageX, Pencil, Trash2 } from "lucide-react";
```

to:

```tsx
import { PackagePlus, PackageX, ClipboardCheck, Pencil, Trash2 } from "lucide-react";
```

Change the outer component's props interface and signature:

```tsx
interface CategoryProductListProps {
  products: ProductWithCategory[];
  categories: Category[];
  onEdit: (product: ProductWithCategory) => void;
  onDelete: (product: ProductWithCategory) => void;
  onReceiveStock: (product: ProductWithCategory) => void;
  onDamageStock: (product: ProductWithCategory) => void;
}

/** Mobile-first grouped product list — horizontal category tabs + active panel. Primary product-management surface on mobile, so edit/delete live here too. */
export function CategoryProductList({ products, categories, onEdit, onDelete, onReceiveStock, onDamageStock }: CategoryProductListProps) {
```

to:

```tsx
interface CategoryProductListProps {
  products: ProductWithCategory[];
  categories: Category[];
  onEdit: (product: ProductWithCategory) => void;
  onDelete: (product: ProductWithCategory) => void;
  onReceiveStock: (product: ProductWithCategory) => void;
  onDamageStock: (product: ProductWithCategory) => void;
  onReconcileStock: (product: ProductWithCategory) => void;
}

/** Mobile-first grouped product list — horizontal category tabs + active panel. Primary product-management surface on mobile, so edit/delete live here too. */
export function CategoryProductList({
  products,
  categories,
  onEdit,
  onDelete,
  onReceiveStock,
  onDamageStock,
  onReconcileStock,
}: CategoryProductListProps) {
```

Update the `<ProductRow />` call inside it:

```tsx
            <ProductRow
              key={product.id}
              product={product}
              onEdit={onEdit}
              onDelete={onDelete}
              onReceiveStock={onReceiveStock}
              onDamageStock={onDamageStock}
            />
```

to:

```tsx
            <ProductRow
              key={product.id}
              product={product}
              onEdit={onEdit}
              onDelete={onDelete}
              onReceiveStock={onReceiveStock}
              onDamageStock={onDamageStock}
              onReconcileStock={onReconcileStock}
            />
```

Update the `ProductRow` function's props and signature:

```tsx
function ProductRow({
  product,
  onEdit,
  onDelete,
  onReceiveStock,
  onDamageStock,
}: {
  product: ProductWithCategory;
  onEdit: (product: ProductWithCategory) => void;
  onDelete: (product: ProductWithCategory) => void;
  onReceiveStock: (product: ProductWithCategory) => void;
  onDamageStock: (product: ProductWithCategory) => void;
}) {
```

to:

```tsx
function ProductRow({
  product,
  onEdit,
  onDelete,
  onReceiveStock,
  onDamageStock,
  onReconcileStock,
}: {
  product: ProductWithCategory;
  onEdit: (product: ProductWithCategory) => void;
  onDelete: (product: ProductWithCategory) => void;
  onReceiveStock: (product: ProductWithCategory) => void;
  onDamageStock: (product: ProductWithCategory) => void;
  onReconcileStock: (product: ProductWithCategory) => void;
}) {
```

Add a new button right after the existing "تسجيل تلف" button inside `ProductRow`'s JSX:

```tsx
        {isAdminRole(role) ? (
          <button
            type="button"
            onClick={() => onDamageStock(product)}
            className="rounded-md p-1.5 text-gray-500 hover:bg-orange-100 hover:text-orange-700"
            aria-label="تسجيل تلف"
          >
            <PackageX className="h-4 w-4" />
          </button>
        ) : null}
        {isAdminRole(role) ? (
          <button
            type="button"
            onClick={() => onReconcileStock(product)}
            className="rounded-md p-1.5 text-gray-500 hover:bg-indigo-100 hover:text-indigo-700"
            aria-label="تسوية المخزون"
          >
            <ClipboardCheck className="h-4 w-4" />
          </button>
        ) : null}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: FAIL — `app/(dashboard)/inventory/page.tsx` no longer satisfies `StockTableProps`/`CategoryProductListProps` (missing `onReconcileStock`). This is expected; Task 5 fixes it.

- [ ] **Step 4: Commit**

```bash
git add components/features/inventory/StockTable.tsx components/features/inventory/CategoryProductList.tsx
git commit -m "Add reconciliation action to StockTable and CategoryProductList"
```

---

### Task 5: Wire the modal into `app/(dashboard)/inventory/page.tsx`

**Files:**
- Modify: `app/(dashboard)/inventory/page.tsx`

**Interfaces:**
- Consumes: `StockReconciliationForm` (Task 3), `onReconcileStock` prop on `StockTable`/`CategoryProductList` (Task 4).

- [ ] **Step 1: Add the import**

Change:

```tsx
import { DamageStockForm } from "@/components/features/inventory/DamageStockForm";
```

to:

```tsx
import { DamageStockForm } from "@/components/features/inventory/DamageStockForm";
import { StockReconciliationForm } from "@/components/features/inventory/StockReconciliationForm";
```

- [ ] **Step 2: Add state**

Change:

```tsx
  const [damagingStockFor, setDamagingStockFor] = useState<Product | ProductWithCategory | null>(null);
```

to:

```tsx
  const [damagingStockFor, setDamagingStockFor] = useState<Product | ProductWithCategory | null>(null);
  const [reconcilingStockFor, setReconcilingStockFor] = useState<Product | ProductWithCategory | null>(null);
```

- [ ] **Step 3: Add the saved-handler**

Change:

```tsx
  function handleStockDamaged() {
    setDamagingStockFor(null);
    void loadData();
  }
```

to:

```tsx
  function handleStockDamaged() {
    setDamagingStockFor(null);
    void loadData();
  }

  function handleStockReconciled() {
    setReconcilingStockFor(null);
    void loadData();
  }
```

- [ ] **Step 4: Pass the prop to both list components**

Change:

```tsx
            <CategoryProductList
              products={filteredProductsWithCategory}
              categories={categories}
              onEdit={openEditForm}
              onDelete={handleDeleteProduct}
              onReceiveStock={openReceiveStockForm}
              onDamageStock={setDamagingStockFor}
            />
          </div>
          <Card className="hidden overflow-hidden p-0 md:block">
            <StockTable
              products={filteredProducts}
              onEdit={openEditForm}
              onDelete={handleDeleteProduct}
              onReceiveStock={openReceiveStockForm}
              onDamageStock={setDamagingStockFor}
            />
```

to:

```tsx
            <CategoryProductList
              products={filteredProductsWithCategory}
              categories={categories}
              onEdit={openEditForm}
              onDelete={handleDeleteProduct}
              onReceiveStock={openReceiveStockForm}
              onDamageStock={setDamagingStockFor}
              onReconcileStock={setReconcilingStockFor}
            />
          </div>
          <Card className="hidden overflow-hidden p-0 md:block">
            <StockTable
              products={filteredProducts}
              onEdit={openEditForm}
              onDelete={handleDeleteProduct}
              onReceiveStock={openReceiveStockForm}
              onDamageStock={setDamagingStockFor}
              onReconcileStock={setReconcilingStockFor}
            />
```

- [ ] **Step 5: Add the modal**

Change:

```tsx
      <Modal open={damagingStockFor !== null} onClose={() => setDamagingStockFor(null)} title="تسجيل تلف مخزون">
        {damagingStockFor ? (
          <DamageStockForm product={damagingStockFor} onSaved={handleStockDamaged} onCancel={() => setDamagingStockFor(null)} />
        ) : null}
      </Modal>
```

to:

```tsx
      <Modal open={damagingStockFor !== null} onClose={() => setDamagingStockFor(null)} title="تسجيل تلف مخزون">
        {damagingStockFor ? (
          <DamageStockForm product={damagingStockFor} onSaved={handleStockDamaged} onCancel={() => setDamagingStockFor(null)} />
        ) : null}
      </Modal>

      <Modal open={reconcilingStockFor !== null} onClose={() => setReconcilingStockFor(null)} title="تسوية المخزون">
        {reconcilingStockFor ? (
          <StockReconciliationForm
            product={reconcilingStockFor}
            onSaved={handleStockReconciled}
            onCancel={() => setReconcilingStockFor(null)}
          />
        ) : null}
      </Modal>
```

- [ ] **Step 6: Verify typecheck, lint, test, and build all pass**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/inventory/page.tsx"
git commit -m "Wire StockReconciliationForm into the inventory page"
```

---

### Task 6: Net reconciliation loss into sales reporting (`services/sales.service.ts`)

**Files:**
- Modify: `services/sales.service.ts`
- Test: `services/sales.service.reconciliation.test.ts`

**Interfaces:**
- Consumes: `StockReconciliation` from `@/types/reconciliations` (Task 1).
- Produces: `getReconciliationLossInRange(supabase, startDate, endDate)`, `sumReconciliationLoss(reconciliations)` (both module-private, mirroring `getDamagesInRange`/`sumLossAmount`); `DailySalesSummary`, `DailyReportDetails`, `DailySalesPoint`, `ProductRankingStat`, `CategoryRankingStat` all gain a `totalReconciliationLoss: number` field — Task 7's `DailyReport.tsx` reads `report.totalReconciliationLoss`.

- [ ] **Step 1: Write the failing test**

Create `services/sales.service.reconciliation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDailySalesSummary } from "./sales.service";
import type { Database } from "@/types/database.types";
import type { Sale, SaleItem } from "@/types/pos";
import type { StockReconciliation } from "@/types/reconciliations";

/**
 * Hand-rolled fake covering exactly the chains getDailySalesSummary
 * exercises for this test: sales.select().gte().lte().order(),
 * sale_items.select().in(), returns.select().gte().lte(),
 * stock_damages.select().gte().lte(), and
 * stock_reconciliations.select().gte().lte(). Deliberately minimal,
 * matching sales.service.returns.test.ts.
 */
function createFakeSupabase(fixtures: {
  sales: Sale[];
  saleItemsBySaleId: Record<string, SaleItem[]>;
  reconciliations: StockReconciliation[];
}): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "sales") {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                order: async () => ({ data: fixtures.sales, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "sale_items") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "sale_id") {
                const rows = values.flatMap((saleId) => fixtures.saleItemsBySaleId[saleId] ?? []);
                return { data: rows, error: null };
              }
              throw new Error(`unexpected sale_items.in column ${column}`);
            },
          }),
        };
      }
      if (table === "returns") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "stock_damages") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "stock_reconciliations") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: fixtures.reconciliations, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

const SALE: Sale = {
  id: "sale-1",
  invoice_number: "INV-1",
  cashier_id: null,
  subtotal: 100,
  discount_amount: 0,
  total_amount: 100,
  paid_amount: 100,
  change_amount: 0,
  payment_method: "cash",
  customer_id: null,
  store_id: "store-1",
  created_at: new Date().toISOString(),
};

const SALE_ITEM: SaleItem = {
  id: "item-1",
  sale_id: "sale-1",
  product_id: "product-1",
  product_name: "منتج",
  barcode: "1111",
  quantity: 10,
  unit_price: 10,
  total_price: 100,
  unit_label: null,
  unit_conversion_factor: 1,
  cost_price: 6,
  store_id: "store-1",
};

describe("getDailySalesSummary — reconciliation regression", () => {
  it("subtracts a shortage reconciliation's loss_value from totalProfit but not totalRevenue", async () => {
    const RECONCILIATION: StockReconciliation = {
      id: "reconciliation-1",
      product_id: "product-1",
      product_name: "منتج",
      unit: "قطعة",
      previous_quantity: 20,
      counted_quantity: 18,
      difference: -2,
      cost_price: 6,
      loss_value: 12,
      reason: "جرد دوري",
      actor_id: null,
      store_id: "store-1",
      created_at: new Date().toISOString(),
    };

    const supabase = createFakeSupabase({
      sales: [SALE],
      saleItemsBySaleId: { "sale-1": [SALE_ITEM] },
      reconciliations: [RECONCILIATION],
    });

    const result = await getDailySalesSummary(supabase, new Date());

    expect(result.totalRevenue).toBe(100);
    expect(result.totalReconciliationLoss).toBe(12);
    expect(result.totalProfit).toBe((10 - 6) * 10 - 12);
  });

  it("does not subtract anything for an overage reconciliation (loss_value 0)", async () => {
    const RECONCILIATION: StockReconciliation = {
      id: "reconciliation-2",
      product_id: "product-1",
      product_name: "منتج",
      unit: "قطعة",
      previous_quantity: 20,
      counted_quantity: 23,
      difference: 3,
      cost_price: 6,
      loss_value: 0,
      reason: "جرد دوري",
      actor_id: null,
      store_id: "store-1",
      created_at: new Date().toISOString(),
    };

    const supabase = createFakeSupabase({
      sales: [SALE],
      saleItemsBySaleId: { "sale-1": [SALE_ITEM] },
      reconciliations: [RECONCILIATION],
    });

    const result = await getDailySalesSummary(supabase, new Date());

    expect(result.totalReconciliationLoss).toBe(0);
    expect(result.totalProfit).toBe((10 - 6) * 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/sales.service.reconciliation.test.ts`
Expected: FAIL — TypeScript error, `Property 'totalReconciliationLoss' does not exist on type 'DailySalesSummary'` (and the fake's `stock_reconciliations` branch is never hit by the current implementation).

- [ ] **Step 3: Add the fetch/sum helpers**

In `services/sales.service.ts`, immediately after the existing `sumLossAmount` function (right before the `dayBounds` function), insert:

```ts
interface ReconciliationForReporting {
  product_id: string | null;
  product_name: string;
  loss_value: number;
  created_at: string;
}

/** Fetches stock_reconciliations whose `created_at` falls in range. loss_value is 0 for overage rows, so summing needs no separate filter. */
async function getReconciliationLossInRange(supabase: Client, startDate: Date, endDate: Date): Promise<ReconciliationForReporting[]> {
  const { data, error } = await supabase
    .from("stock_reconciliations")
    .select("product_id, product_name, loss_value, created_at")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (error) throw error;
  return data ?? [];
}

function sumReconciliationLoss(reconciliations: ReconciliationForReporting[]): number {
  return reconciliations.reduce((sum, row) => sum + row.loss_value, 0);
}
```

- [ ] **Step 4: Update `DailySalesSummary` and `getDailySalesSummary`**

Change the interface:

```ts
export interface DailySalesSummary {
  sales: Sale[];
  salesCount: number;
  /** Nets against returns.refund_amount for the day (see totalReturnsValue). */
  totalRevenue: number;
  /** grossProfit - returnsProfitReversal - totalDamageLoss (see services/sales.service.ts module doc / plan). */
  totalProfit: number;
  /** sum(returns.refund_amount) for returns whose created_at falls on this day — also already netted into totalRevenue. */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) for damages whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
}
```

to:

```ts
export interface DailySalesSummary {
  sales: Sale[];
  salesCount: number;
  /** Nets against returns.refund_amount for the day (see totalReturnsValue). */
  totalRevenue: number;
  /** grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss (see services/sales.service.ts module doc / plan). */
  totalProfit: number;
  /** sum(returns.refund_amount) for returns whose created_at falls on this day — also already netted into totalRevenue. */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) for damages whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for reconciliations whose created_at falls on this day — also already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
}
```

Change the function body:

```ts
export async function getDailySalesSummary(supabase: Client, date: Date): Promise<DailySalesSummary> {
  const sales = await getDailySales(supabase, date);
  const { dayStart, dayEnd } = dayBounds(date);

  const [grossProfit, { returns, saleItemById }, damages] = await Promise.all([
    computeProfitForSales(supabase, sales),
    getReturnsInRange(supabase, dayStart, dayEnd),
    getDamagesInRange(supabase, dayStart, dayEnd),
  ]);

  const returnsProfitReversal = computeReturnsProfitReversal(returns, saleItemById);
  const totalReturnsValue = sumRefundAmount(returns);
  const totalDamageLoss = sumLossAmount(damages);

  const grossRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalRevenue = grossRevenue - totalReturnsValue;
  const totalProfit = grossProfit - returnsProfitReversal - totalDamageLoss;

  return { sales, salesCount: sales.length, totalRevenue, totalProfit, totalReturnsValue, totalDamageLoss };
}
```

to:

```ts
export async function getDailySalesSummary(supabase: Client, date: Date): Promise<DailySalesSummary> {
  const sales = await getDailySales(supabase, date);
  const { dayStart, dayEnd } = dayBounds(date);

  const [grossProfit, { returns, saleItemById }, damages, reconciliations] = await Promise.all([
    computeProfitForSales(supabase, sales),
    getReturnsInRange(supabase, dayStart, dayEnd),
    getDamagesInRange(supabase, dayStart, dayEnd),
    getReconciliationLossInRange(supabase, dayStart, dayEnd),
  ]);

  const returnsProfitReversal = computeReturnsProfitReversal(returns, saleItemById);
  const totalReturnsValue = sumRefundAmount(returns);
  const totalDamageLoss = sumLossAmount(damages);
  const totalReconciliationLoss = sumReconciliationLoss(reconciliations);

  const grossRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalRevenue = grossRevenue - totalReturnsValue;
  const totalProfit = grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss;

  return {
    sales,
    salesCount: sales.length,
    totalRevenue,
    totalProfit,
    totalReturnsValue,
    totalDamageLoss,
    totalReconciliationLoss,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run services/sales.service.reconciliation.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Update `DailyReportDetails` and `getDailyReportDetails`**

Change the interface — add this field right after the existing `totalDamageLoss` doc comment/field:

```ts
  /** sum(stock_damages.loss_amount) for damages whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
  hourlyBreakdown: HourlyBucket[];
```

to:

```ts
  /** sum(stock_damages.loss_amount) for damages whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for reconciliations whose created_at falls on this day — also already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
  hourlyBreakdown: HourlyBucket[];
```

Change the function body — the `Promise.all` and totals block:

```ts
  const [grossProfit, { returns, saleItemById }, damages, yesterdayTotals, lastWeekTotals] = await Promise.all([
    computeProfitForSales(supabase, sales),
    getReturnsInRange(supabase, dayStart, dayEnd),
    getDamagesInRange(supabase, dayStart, dayEnd),
    getDayTotals(supabase, yesterday),
    getDayTotals(supabase, lastWeekSameDay),
  ]);

  const returnsProfitReversal = computeReturnsProfitReversal(returns, saleItemById);
  const totalReturnsValue = sumRefundAmount(returns);
  const totalDamageLoss = sumLossAmount(damages);

  const grossRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalRevenue = grossRevenue - totalReturnsValue;
  const totalProfit = grossProfit - returnsProfitReversal - totalDamageLoss;
```

to:

```ts
  const [grossProfit, { returns, saleItemById }, damages, reconciliations, yesterdayTotals, lastWeekTotals] = await Promise.all([
    computeProfitForSales(supabase, sales),
    getReturnsInRange(supabase, dayStart, dayEnd),
    getDamagesInRange(supabase, dayStart, dayEnd),
    getReconciliationLossInRange(supabase, dayStart, dayEnd),
    getDayTotals(supabase, yesterday),
    getDayTotals(supabase, lastWeekSameDay),
  ]);

  const returnsProfitReversal = computeReturnsProfitReversal(returns, saleItemById);
  const totalReturnsValue = sumRefundAmount(returns);
  const totalDamageLoss = sumLossAmount(damages);
  const totalReconciliationLoss = sumReconciliationLoss(reconciliations);

  const grossRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalRevenue = grossRevenue - totalReturnsValue;
  const totalProfit = grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss;
```

And the function's final `return` statement:

```ts
  return {
    date: dateKey.toISOString().slice(0, 10),
    sales,
    salesCount: sales.length,
    totalRevenue,
    totalProfit,
    averageInvoiceValue,
    highestInvoice,
    lowestInvoice,
    totalDiscountGiven,
    totalItemsSold,
    totalReturnsValue,
    totalDamageLoss,
    hourlyBreakdown,
    comparisonWithYesterday: buildComparison({ revenue: totalRevenue, count: sales.length }, yesterdayTotals),
    comparisonWithLastWeekSameDay: buildComparison({ revenue: totalRevenue, count: sales.length }, lastWeekTotals),
  };
```

to:

```ts
  return {
    date: dateKey.toISOString().slice(0, 10),
    sales,
    salesCount: sales.length,
    totalRevenue,
    totalProfit,
    averageInvoiceValue,
    highestInvoice,
    lowestInvoice,
    totalDiscountGiven,
    totalItemsSold,
    totalReturnsValue,
    totalDamageLoss,
    totalReconciliationLoss,
    hourlyBreakdown,
    comparisonWithYesterday: buildComparison({ revenue: totalRevenue, count: sales.length }, yesterdayTotals),
    comparisonWithLastWeekSameDay: buildComparison({ revenue: totalRevenue, count: sales.length }, lastWeekTotals),
  };
```

- [ ] **Step 7: Update `DailySalesPoint` and `getSalesTrend`**

Change the interface:

```ts
export interface DailySalesPoint {
  date: string;
  /** Nets against that day's returns.refund_amount (see totalReturnsValue). */
  totalRevenue: number;
  /** grossProfit - returnsProfitReversal - totalDamageLoss for this day — see getDailySalesSummary. */
  totalProfit: number;
  salesCount: number;
  averageInvoiceValue: number;
  /** sum(returns.refund_amount) whose created_at falls on this day — also already netted into totalRevenue. */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
}
```

to:

```ts
export interface DailySalesPoint {
  date: string;
  /** Nets against that day's returns.refund_amount (see totalReturnsValue). */
  totalRevenue: number;
  /** grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss for this day — see getDailySalesSummary. */
  totalProfit: number;
  salesCount: number;
  averageInvoiceValue: number;
  /** sum(returns.refund_amount) whose created_at falls on this day — also already netted into totalRevenue. */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) whose created_at falls on this day — also already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
}
```

Change the `Promise.all` at the top of `getSalesTrend`:

```ts
  const [{ data: sales, error }, { returns, saleItemById }, damages] = await Promise.all([
    supabase
      .from("sales")
      .select("id, created_at, total_amount")
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString()),
    getReturnsInRange(supabase, startDate, endDate),
    getDamagesInRange(supabase, startDate, endDate),
  ]);
```

to:

```ts
  const [{ data: sales, error }, { returns, saleItemById }, damages, reconciliations] = await Promise.all([
    supabase
      .from("sales")
      .select("id, created_at, total_amount")
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString()),
    getReturnsInRange(supabase, startDate, endDate),
    getDamagesInRange(supabase, startDate, endDate),
    getReconciliationLossInRange(supabase, startDate, endDate),
  ]);
```

Change the local `Bucket` interface and `emptyBucket`:

```ts
  interface Bucket {
    grossRevenue: number;
    grossProfit: number;
    salesCount: number;
    returnsProfitReversal: number;
    totalReturnsValue: number;
    totalDamageLoss: number;
  }

  const emptyBucket = (): Bucket => ({
    grossRevenue: 0,
    grossProfit: 0,
    salesCount: 0,
    returnsProfitReversal: 0,
    totalReturnsValue: 0,
    totalDamageLoss: 0,
  });
```

to:

```ts
  interface Bucket {
    grossRevenue: number;
    grossProfit: number;
    salesCount: number;
    returnsProfitReversal: number;
    totalReturnsValue: number;
    totalDamageLoss: number;
    totalReconciliationLoss: number;
  }

  const emptyBucket = (): Bucket => ({
    grossRevenue: 0,
    grossProfit: 0,
    salesCount: 0,
    returnsProfitReversal: 0,
    totalReturnsValue: 0,
    totalDamageLoss: 0,
    totalReconciliationLoss: 0,
  });
```

Right after the existing `damages.forEach(...)` block, add:

```ts
  reconciliations.forEach((row) => {
    const dayKey = dayKeyOf(row.created_at);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    bucket.totalReconciliationLoss += row.loss_value;
    byDate.set(dayKey, bucket);
  });
```

Change the points loop:

```ts
  const points: DailySalesPoint[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dayKey = dayKeyOf(cursor);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    const totalRevenue = bucket.grossRevenue - bucket.totalReturnsValue;
    const totalProfit = bucket.grossProfit - bucket.returnsProfitReversal - bucket.totalDamageLoss;
    points.push({
      date: dayKey,
      totalRevenue,
      totalProfit,
      salesCount: bucket.salesCount,
      averageInvoiceValue: bucket.salesCount > 0 ? totalRevenue / bucket.salesCount : 0,
      totalReturnsValue: bucket.totalReturnsValue,
      totalDamageLoss: bucket.totalDamageLoss,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
```

to:

```ts
  const points: DailySalesPoint[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dayKey = dayKeyOf(cursor);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    const totalRevenue = bucket.grossRevenue - bucket.totalReturnsValue;
    const totalProfit = bucket.grossProfit - bucket.returnsProfitReversal - bucket.totalDamageLoss - bucket.totalReconciliationLoss;
    points.push({
      date: dayKey,
      totalRevenue,
      totalProfit,
      salesCount: bucket.salesCount,
      averageInvoiceValue: bucket.salesCount > 0 ? totalRevenue / bucket.salesCount : 0,
      totalReturnsValue: bucket.totalReturnsValue,
      totalDamageLoss: bucket.totalDamageLoss,
      totalReconciliationLoss: bucket.totalReconciliationLoss,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
```

- [ ] **Step 8: Update `ProductRankingStat` and `getProductRanking`**

Change the interface — add the field right after the existing `totalDamageLoss` field:

```ts
  /** sum(stock_damages.loss_amount) for this product in range — already subtracted from totalProfit. */
  totalDamageLoss: number;
}
```

(the one inside `ProductRankingStat`) to:

```ts
  /** sum(stock_damages.loss_amount) for this product in range — already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for this product in range — already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
}
```

In `getProductRanking`, change:

```ts
  const { returns, saleItemById } = await getReturnsInRange(supabase, startDate, endDate);
  const damages = await getDamagesInRange(supabase, startDate, endDate);

  if ((!sales || sales.length === 0) && returns.length === 0 && damages.length === 0) return [];
```

to:

```ts
  const { returns, saleItemById } = await getReturnsInRange(supabase, startDate, endDate);
  const damages = await getDamagesInRange(supabase, startDate, endDate);
  const reconciliations = await getReconciliationLossInRange(supabase, startDate, endDate);

  if ((!sales || sales.length === 0) && returns.length === 0 && damages.length === 0 && reconciliations.length === 0) return [];
```

Change the `productIds` computation:

```ts
  const productIds = Array.from(
    new Set(
      [...items.map((item) => item.product_id), ...returns.map((row) => row.product_id), ...damages.map((row) => row.product_id)].filter(
        (id): id is string => id !== null,
      ),
    ),
  );
```

to:

```ts
  const productIds = Array.from(
    new Set(
      [
        ...items.map((item) => item.product_id),
        ...returns.map((row) => row.product_id),
        ...damages.map((row) => row.product_id),
        ...reconciliations.map((row) => row.product_id),
      ].filter((id): id is string => id !== null),
    ),
  );
```

Change the `ensureBucket` helper's created object:

```ts
    const created: Accumulator = {
      productId,
      productName,
      categoryId,
      categoryName: categoryId ? (categoryNameById.get(categoryId) ?? UNCATEGORIZED_LABEL) : UNCATEGORIZED_LABEL,
      totalQuantity: 0,
      totalRevenue: 0,
      totalProfit: 0,
      revenueSharePercent: 0,
      saleCount: 0,
      totalReturnsValue: 0,
      totalDamageLoss: 0,
      saleIds: new Set(),
    };
```

to:

```ts
    const created: Accumulator = {
      productId,
      productName,
      categoryId,
      categoryName: categoryId ? (categoryNameById.get(categoryId) ?? UNCATEGORIZED_LABEL) : UNCATEGORIZED_LABEL,
      totalQuantity: 0,
      totalRevenue: 0,
      totalProfit: 0,
      revenueSharePercent: 0,
      saleCount: 0,
      totalReturnsValue: 0,
      totalDamageLoss: 0,
      totalReconciliationLoss: 0,
      saleIds: new Set(),
    };
```

Right after the existing `damages.forEach(...)` block in `getProductRanking`, add:

```ts
  reconciliations.forEach((row) => {
    const key = productRankingKey(row.product_id, row.product_name);
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(key, row.product_id, row.product_name, categoryId);
    bucket.totalReconciliationLoss += row.loss_value;
    bucket.totalProfit -= row.loss_value;
  });
```

Change the final `.map(...)` in `getProductRanking`:

```ts
  return stats
    .map((stat) => ({
      productId: stat.productId,
      productName: stat.productName,
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      totalQuantity: stat.totalQuantity,
      totalRevenue: stat.totalRevenue,
      totalProfit: stat.totalProfit,
      revenueSharePercent: grandTotalRevenue > 0 ? (stat.totalRevenue / grandTotalRevenue) * 100 : 0,
      saleCount: stat.saleIds.size,
      totalReturnsValue: stat.totalReturnsValue,
      totalDamageLoss: stat.totalDamageLoss,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
```

to:

```ts
  return stats
    .map((stat) => ({
      productId: stat.productId,
      productName: stat.productName,
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      totalQuantity: stat.totalQuantity,
      totalRevenue: stat.totalRevenue,
      totalProfit: stat.totalProfit,
      revenueSharePercent: grandTotalRevenue > 0 ? (stat.totalRevenue / grandTotalRevenue) * 100 : 0,
      saleCount: stat.saleIds.size,
      totalReturnsValue: stat.totalReturnsValue,
      totalDamageLoss: stat.totalDamageLoss,
      totalReconciliationLoss: stat.totalReconciliationLoss,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
```

- [ ] **Step 9: Update `CategoryRankingStat` and `getCategoryRanking`**

Change the interface — add the field right after the existing `totalDamageLoss` field (the one inside `CategoryRankingStat`):

```ts
  /** sum(stock_damages.loss_amount) for this category in range — already subtracted from totalProfit. */
  totalDamageLoss: number;
}
```

to:

```ts
  /** sum(stock_damages.loss_amount) for this category in range — already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for this category in range — already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
}
```

In `getCategoryRanking`, change:

```ts
  const { returns, saleItemById } = await getReturnsInRange(supabase, startDate, endDate);
  const damages = await getDamagesInRange(supabase, startDate, endDate);

  if ((!sales || sales.length === 0) && returns.length === 0 && damages.length === 0) return [];
```

(the occurrence inside `getCategoryRanking`) to:

```ts
  const { returns, saleItemById } = await getReturnsInRange(supabase, startDate, endDate);
  const damages = await getDamagesInRange(supabase, startDate, endDate);
  const reconciliations = await getReconciliationLossInRange(supabase, startDate, endDate);

  if ((!sales || sales.length === 0) && returns.length === 0 && damages.length === 0 && reconciliations.length === 0) return [];
```

Change the `productIds` computation inside `getCategoryRanking`:

```ts
  const productIds = Array.from(
    new Set(
      [...items.map((item) => item.product_id), ...returns.map((row) => row.product_id), ...damages.map((row) => row.product_id)].filter(
        (id): id is string => id !== null,
      ),
    ),
  );
```

(the occurrence inside `getCategoryRanking`) to:

```ts
  const productIds = Array.from(
    new Set(
      [
        ...items.map((item) => item.product_id),
        ...returns.map((row) => row.product_id),
        ...damages.map((row) => row.product_id),
        ...reconciliations.map((row) => row.product_id),
      ].filter((id): id is string => id !== null),
    ),
  );
```

Change the `ensureBucket` helper's created object inside `getCategoryRanking`:

```ts
    const created: Accumulator = {
      categoryId,
      categoryName: category?.name ?? UNCATEGORIZED_LABEL,
      categoryColor: category?.color ?? UNCATEGORIZED_COLOR,
      categoryIcon: category?.icon ?? UNCATEGORIZED_ICON,
      totalQuantity: 0,
      totalRevenue: 0,
      totalProfit: 0,
      revenueSharePercent: 0,
      saleCount: 0,
      totalReturnsValue: 0,
      totalDamageLoss: 0,
      saleIds: new Set(),
    };
```

to:

```ts
    const created: Accumulator = {
      categoryId,
      categoryName: category?.name ?? UNCATEGORIZED_LABEL,
      categoryColor: category?.color ?? UNCATEGORIZED_COLOR,
      categoryIcon: category?.icon ?? UNCATEGORIZED_ICON,
      totalQuantity: 0,
      totalRevenue: 0,
      totalProfit: 0,
      revenueSharePercent: 0,
      saleCount: 0,
      totalReturnsValue: 0,
      totalDamageLoss: 0,
      totalReconciliationLoss: 0,
      saleIds: new Set(),
    };
```

Right after the existing `damages.forEach(...)` block in `getCategoryRanking`, add:

```ts
  reconciliations.forEach((row) => {
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(categoryId);
    bucket.totalReconciliationLoss += row.loss_value;
    bucket.totalProfit -= row.loss_value;
  });
```

Change the final `.map(...)` in `getCategoryRanking`:

```ts
  return stats
    .map((stat) => ({
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      categoryColor: stat.categoryColor,
      categoryIcon: stat.categoryIcon,
      totalQuantity: stat.totalQuantity,
      totalRevenue: stat.totalRevenue,
      totalProfit: stat.totalProfit,
      revenueSharePercent: grandTotalRevenue > 0 ? (stat.totalRevenue / grandTotalRevenue) * 100 : 0,
      saleCount: stat.saleIds.size,
      totalReturnsValue: stat.totalReturnsValue,
      totalDamageLoss: stat.totalDamageLoss,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
```

to:

```ts
  return stats
    .map((stat) => ({
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      categoryColor: stat.categoryColor,
      categoryIcon: stat.categoryIcon,
      totalQuantity: stat.totalQuantity,
      totalRevenue: stat.totalRevenue,
      totalProfit: stat.totalProfit,
      revenueSharePercent: grandTotalRevenue > 0 ? (stat.totalRevenue / grandTotalRevenue) * 100 : 0,
      saleCount: stat.saleIds.size,
      totalReturnsValue: stat.totalReturnsValue,
      totalDamageLoss: stat.totalDamageLoss,
      totalReconciliationLoss: stat.totalReconciliationLoss,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
```

- [ ] **Step 10: Run the full test suite and verify everything passes**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: PASS — including the pre-existing `sales.service.returns.test.ts` and `sales.service.test.ts` suites (regression check: damage/returns netting must be unaffected).

- [ ] **Step 11: Commit**

```bash
git add services/sales.service.ts services/sales.service.reconciliation.test.ts
git commit -m "Net reconciliation shrinkage loss into sales reporting"
```

---

### Task 7: Show reconciliation loss in `DailyReport.tsx`

**Files:**
- Modify: `components/features/sales/DailyReport.tsx`

**Interfaces:**
- Consumes: `report.totalReconciliationLoss` (from `DailyReportDetails`, Task 6).

- [ ] **Step 1: Add the card**

Change:

```tsx
        <Card>
          <p className="text-sm text-gray-500">إجمالي الخسائر</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalDamageLoss)}</p>
        </Card>
```

to:

```tsx
        <Card>
          <p className="text-sm text-gray-500">إجمالي الخسائر</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalDamageLoss)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">فروقات الجرد</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalReconciliationLoss)}</p>
        </Card>
```

- [ ] **Step 2: Verify typecheck, lint, test, and build all pass**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/features/sales/DailyReport.tsx
git commit -m "Show stock-reconciliation loss on the daily sales report"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (no code changes — this task is a manual check against a running dev server).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the admin flow**

As an admin user, open `/inventory`, find a product, click "تسوية" (both on the mobile `CategoryProductList` view and the desktop `StockTable` view). Enter a counted quantity lower than the system quantity, pick "اشتباه سرقة", submit. Confirm: the product's displayed quantity updates immediately, the submit button was disabled until a differing quantity was entered, and no error is shown.

- [ ] **Step 3: Verify the overage path**

Repeat with a counted quantity higher than system quantity. Confirm the quantity updates and the preview text shows "زيادة N" with no loss amount shown (since overage has zero loss).

- [ ] **Step 4: Verify the report**

Open `/sales`, view today's daily report. Confirm a new "فروقات الجرد" card shows the loss value from Step 2's shortage (and is unaffected by Step 3's overage).

- [ ] **Step 5: Verify non-admin invisibility**

Log in as a cashier-role user (or temporarily inspect with `role !== "admin"`). Confirm the "تسوية" button does not render on either inventory view.

- [ ] **Step 6: Report results to the user**

No commit for this task — report the manual verification outcome (pass/fail per step) back to the user.
