# Product Batch/Expiry Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add batch-level expiry tracking to dddmart — an optional expiry date on stock receiving that creates a `product_batches` record, surfaced through a near-expiry alerts screen that either role can view and clear.

**Architecture:** A new append-only-but-deletable `product_batches` table, fed directly from `services/products.service.ts#recordStockPurchase` (the same function already extended for suppliers/invoices). A new `services/batches.service.ts` powers a near-expiry count on the existing inventory page (mirroring the existing low-stock-count pattern) and a dedicated `/inventory/expiry` list page.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (`@supabase/supabase-js`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-product-batch-expiry-design.md`

## Global Constraints

- Batches are NOT linked to sale/return/damage/reconciliation stock deduction — `quantity` on a batch means quantity received, not quantity remaining. Staff clear batches manually.
- The expiry-date field on the receiving form is visible to BOTH admin and cashier — unlike the existing supplier/invoice/payment fields, which stay admin-only.
- The near-expiry alerts page (`/inventory/expiry`) has no admin gate — both roles can view and delete batches from it.
- Alert threshold is a fixed 30 days (not configurable this phase).
- `product_batches` allows delete (unlike the append-only `stock_purchases`/`stock_damages`) — it's a working record, not financial/audit history. No update policy.
- Batch inserts/deletes are NOT separately audit-logged (same reasoning as `supplier_products` linking) — routine data entry, not a financial/security event.
- `types/database.types.ts` is hand-authored — every migration change needs a matching manual edit there.
- Test commands: `npm run typecheck && npm run lint && npm run test && npm run build` — all must pass before each task's commit.
- Do not apply the migration to the live Supabase project and do not push to `origin/main` — both require the user's own explicit confirmation afterward, per this project's established convention.

---

### Task 1: Database schema — migration + hand-authored types

**Files:**
- Create: `supabase/migrations/00000000000018_product_batches.sql`
- Modify: `types/database.types.ts`

**Interfaces:**
- Produces: `product_batches` table (id, product_id, product_name, quantity, expiry_date, received_at, store_id, created_at).

- [ ] **Step 1: Write the migration file**

```sql
-- Product batch/expiry tracking (gap #6 in docs/gaps-analysis.md).
--
-- product_batches: one row per batch of stock with a known expiry date,
-- created optionally when receiving stock (see recordStockPurchase in
-- services/products.service.ts). Deliberately NOT linked to sale/return/
-- damage/reconciliation stock deduction — the app has no way to know
-- which physical batch a sold unit came from without rewriting stock
-- deduction everywhere it happens, which is out of scope. quantity
-- therefore means "quantity received in this batch", not "quantity
-- currently on the shelf" — staff clear a batch manually from the
-- near-expiry alerts screen once it's sold through or discarded.
--
-- Unlike the append-only stock_purchases/stock_damages tables, this one
-- allows delete (no update) — a batch is a working record staff clear,
-- not permanent financial/audit history. product_id uses "on delete
-- cascade" rather than stock_damages' "set null" convention, since a
-- batch has zero standalone value once its product is gone.
create table product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete cascade,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  expiry_date date not null,
  received_at timestamptz not null default now(),
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now()
);

create index product_batches_product_id_idx on product_batches (product_id);
create index product_batches_store_id_idx on product_batches (store_id);
create index product_batches_expiry_date_idx on product_batches (expiry_date);

alter table product_batches enable row level security;

create policy "authenticated read product_batches" on product_batches for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert product_batches" on product_batches for insert to authenticated
  with check (store_id = current_store_id());

create policy "authenticated delete product_batches" on product_batches for delete to authenticated
  using (store_id = current_store_id());
```

- [ ] **Step 2: Add the `product_batches` table entry**

In `types/database.types.ts`, find the `stock_purchases` table block (it ends with a `Relationships: [...]` array followed by `};`, immediately before the `operations_log:` entry). Insert the following new table entry immediately after `stock_purchases`'s closing `};` and before `operations_log:`:

```ts
      product_batches: {
        Row: {
          id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          expiry_date: string;
          received_at: string;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          expiry_date: string;
          received_at?: string;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          expiry_date?: string;
          received_at?: string;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_batches_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00000000000018_product_batches.sql types/database.types.ts
git commit -m "feat: add product_batches schema"
```

---

### Task 2: Extend `recordStockPurchase` with expiry-date recording

**Files:**
- Modify: `types/product.ts`
- Modify: `services/products.service.ts`
- Modify: `services/products.service.test.ts`

**Interfaces:**
- Consumes: `product_batches` (Task 1).
- Produces: `ProductBatch`/`ProductBatchInsert`/`ProductBatchWithProduct` types, `daysUntilExpiry(expiryDate: string): number`; `recordStockPurchase` gains one new optional param `expiryDate?: string | null` — consumed by `services/batches.service.ts` (Task 3, via the types) and `ReceiveStockForm.tsx` (Task 4).

- [ ] **Step 1: Add batch types to `types/product.ts`**

In `types/product.ts`, insert these three lines right after the existing `export type ProductUnitUpdate = ...` line (before `export interface ProductWithCategory ...`):

```ts
export type ProductBatch = Database["public"]["Tables"]["product_batches"]["Row"];
export type ProductBatchInsert = Database["public"]["Tables"]["product_batches"]["Insert"];

export interface ProductBatchWithProduct extends ProductBatch {
  product: Product;
}
```

Then append this function at the end of the file, after the existing `isCategoryActive` function:

```ts
/** Whole calendar days from today (local midnight) until expiryDate — negative if already past. */
export function daysUntilExpiry(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  const diffMs = expiry.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
```

- [ ] **Step 2: Write the failing tests**

In `services/products.service.test.ts`, make these changes:

1. Extend the fake's return type and `from` routing. Find `createFakeSupabaseForReceiveStock`'s return type declaration and its `from` routing function. Add a `batchInsertSpy` alongside the existing spies:

```ts
function createFakeSupabaseForReceiveStock(options: {
  rpcData: Product[] | null;
  rpcError?: unknown;
  insertedStockPurchase?: StockPurchase;
}): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
  stockPurchaseInsertSpy: ReturnType<typeof vi.fn>;
  supplierTransactionInsertSpy: ReturnType<typeof vi.fn>;
  batchInsertSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => ({ data: options.rpcData, error: options.rpcError ?? null }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));
  const stockPurchaseInsertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedStockPurchase ?? INSERTED_STOCK_PURCHASE, error: null }),
    }),
  }));
  const supplierTransactionInsertSpy = vi.fn(async () => ({ data: null, error: null }));
  const batchInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "stock_purchases") return { insert: stockPurchaseInsertSpy };
      if (table === "supplier_transactions") return { insert: supplierTransactionInsertSpy };
      if (table === "product_batches") return { insert: batchInsertSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, logInsertSpy, stockPurchaseInsertSpy, supplierTransactionInsertSpy, batchInsertSpy };
}
```

2. Add these two new tests inside the existing `describe("recordStockPurchase", ...)` block, after the last existing test (`"with no supplier, never touches supplier_transactions"`):

```ts
  it("inserts a product_batches row when an expiryDate is given", async () => {
    const { supabase, batchInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
        expiryDate: "2026-03-01",
      },
      "user-1",
      "store-1",
    );
    expect(batchInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: "product-1",
        product_name: "علبة علك",
        quantity: 10,
        expiry_date: "2026-03-01",
        store_id: "store-1",
      }),
    );
  });

  it("does not insert a product_batches row when no expiryDate is given", async () => {
    const { supabase, batchInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
      },
      "user-1",
      "store-1",
    );
    expect(batchInsertSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `npm run test -- products.service`
Expected: all pre-existing tests still PASS unchanged; the 2 new tests FAIL because `recordStockPurchase` doesn't yet accept `expiryDate` or insert into `product_batches`.

- [ ] **Step 4: Implement the extended `recordStockPurchase`**

In `services/products.service.ts`, add `expiryDate?: string | null;` to the end of the `RecordStockPurchaseParams` interface (after `paymentMethod?: PaymentMethod | null;`):

```ts
export interface RecordStockPurchaseParams {
  productId: string;
  productName: string;
  purchasedQuantity: number;
  unitName: string | null; // null = base unit (products.unit)
  conversionFactor: number; // 1 for base unit
  costPerPurchasedUnit: number;
  supplierId?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  paymentMethod?: PaymentMethod | null;
  expiryDate?: string | null;
}
```

Then, inside `recordStockPurchase`, find this block (the end of the `if (params.supplierId) { ... }` block, right before the `const supplierNote = ...` line):

```ts
    if (params.paymentMethod === "cash") {
      const { error: paymentTxnError } = await supabase.from("supplier_transactions").insert({
        supplier_id: params.supplierId,
        type: "payment",
        amount: totalCost,
        note: transactionNote,
        stock_purchase_id: purchase.id,
        store_id: storeId,
      });
      if (paymentTxnError) throw paymentTxnError;
    }
  }

  const supplierNote = params.supplierId
```

Insert a new block between the closing `}` of `if (params.supplierId)` and the `const supplierNote = ...` line, so it reads:

```ts
    if (params.paymentMethod === "cash") {
      const { error: paymentTxnError } = await supabase.from("supplier_transactions").insert({
        supplier_id: params.supplierId,
        type: "payment",
        amount: totalCost,
        note: transactionNote,
        stock_purchase_id: purchase.id,
        store_id: storeId,
      });
      if (paymentTxnError) throw paymentTxnError;
    }
  }

  if (params.expiryDate) {
    const { error: batchError } = await supabase.from("product_batches").insert({
      product_id: params.productId,
      product_name: params.productName,
      quantity: addedBaseUnits,
      expiry_date: params.expiryDate,
      store_id: storeId,
    });
    if (batchError) throw batchError;
  }

  const supplierNote = params.supplierId
```

Finally, find the `logOperation` call at the end of the function:

```ts
  const supplierNote = params.supplierId
    ? ` — مورد: ${params.supplierName ?? ""}${params.invoiceNumber ? `، فاتورة رقم ${params.invoiceNumber}` : ""}`
    : "";

  await logOperation(supabase, {
    userId: actorId,
    actionType: "stock_received",
    entityType: "stock",
    entityId: updated.id,
    description: `تم استلام ${params.purchasedQuantity} ${params.unitName ?? "قطعة"} (${addedBaseUnits} ${updated.unit}) من "${params.productName}" — سعر التكلفة الجديد ${updated.cost_price}${supplierNote}`,
    storeId,
  });

  return updated;
}
```

Replace it with:

```ts
  const supplierNote = params.supplierId
    ? ` — مورد: ${params.supplierName ?? ""}${params.invoiceNumber ? `، فاتورة رقم ${params.invoiceNumber}` : ""}`
    : "";
  const expiryNote = params.expiryDate ? ` — صلاحية حتى ${params.expiryDate}` : "";

  await logOperation(supabase, {
    userId: actorId,
    actionType: "stock_received",
    entityType: "stock",
    entityId: updated.id,
    description: `تم استلام ${params.purchasedQuantity} ${params.unitName ?? "قطعة"} (${addedBaseUnits} ${updated.unit}) من "${params.productName}" — سعر التكلفة الجديد ${updated.cost_price}${supplierNote}${expiryNote}`,
    storeId,
  });

  return updated;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- products.service`
Expected: PASS (all previous tests plus the 2 new ones — 18 total).

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add types/product.ts services/products.service.ts services/products.service.test.ts
git commit -m "feat: record a product batch when stock is received with an expiry date"
```

---

### Task 3: `services/batches.service.ts` — list and clear near-expiry batches

**Files:**
- Create: `services/batches.service.ts`
- Create: `services/batches.service.test.ts`

**Interfaces:**
- Consumes: `ProductBatchWithProduct` (Task 2, `types/product.ts`).
- Produces: `listExpiringBatches(supabase, options?: { withinDays?: number }): Promise<ProductBatchWithProduct[]>`; `deleteBatch(supabase, id: string): Promise<void>` — both consumed by `app/(dashboard)/inventory/page.tsx` and `app/(dashboard)/inventory/expiry/page.tsx` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `services/batches.service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listExpiringBatches, deleteBatch } from "./batches.service";
import type { Database } from "@/types/database.types";

/**
 * Hand-rolled fake covering only the chain listExpiringBatches actually
 * calls: product_batches.select().lte().order(). Not a general Supabase
 * mock — deliberately minimal, matching the other fakes in this repo.
 */
function createFakeSupabaseForList(rows: unknown[]): {
  supabase: SupabaseClient<Database>;
  lteSpy: ReturnType<typeof vi.fn>;
} {
  const lteSpy = vi.fn(() => ({
    order: async () => ({ data: rows, error: null }),
  }));
  const supabase = {
    from: () => ({
      select: () => ({ lte: lteSpy }),
    }),
  } as unknown as SupabaseClient<Database>;
  return { supabase, lteSpy };
}

describe("listExpiringBatches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1)); // Jan 1, 2026, local time
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to a 30-day cutoff from today", async () => {
    const { supabase, lteSpy } = createFakeSupabaseForList([]);
    await listExpiringBatches(supabase);
    expect(lteSpy).toHaveBeenCalledWith("expiry_date", "2026-01-31");
  });

  it("respects a custom withinDays", async () => {
    const { supabase, lteSpy } = createFakeSupabaseForList([]);
    await listExpiringBatches(supabase, { withinDays: 7 });
    expect(lteSpy).toHaveBeenCalledWith("expiry_date", "2026-01-08");
  });

  it("returns the rows from the query unchanged", async () => {
    const rows = [{ id: "batch-1" }];
    const { supabase } = createFakeSupabaseForList(rows);
    const result = await listExpiringBatches(supabase);
    expect(result).toEqual(rows);
  });

  it("returns an empty array when there are none", async () => {
    const { supabase } = createFakeSupabaseForList([]);
    const result = await listExpiringBatches(supabase);
    expect(result).toEqual([]);
  });
});

describe("deleteBatch", () => {
  it("deletes the batch scoped by id", async () => {
    const eqSpy = vi.fn(async () => ({ error: null }));
    const deleteSpy = vi.fn(() => ({ eq: eqSpy }));
    const supabase = {
      from: () => ({ delete: deleteSpy }),
    } as unknown as SupabaseClient<Database>;

    await deleteBatch(supabase, "batch-1");

    expect(deleteSpy).toHaveBeenCalled();
    expect(eqSpy).toHaveBeenCalledWith("id", "batch-1");
  });

  it("throws when the delete returns an error", async () => {
    const eqSpy = vi.fn(async () => ({ error: new Error("boom") }));
    const supabase = {
      from: () => ({ delete: () => ({ eq: eqSpy }) }),
    } as unknown as SupabaseClient<Database>;

    await expect(deleteBatch(supabase, "batch-1")).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- batches.service`
Expected: FAIL — `services/batches.service.ts` does not exist yet.

- [ ] **Step 3: Implement `services/batches.service.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ProductBatchWithProduct } from "@/types/product";

type Client = SupabaseClient<Database>;

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface ListExpiringBatchesOptions {
  withinDays?: number;
}

/** Batches expiring within withinDays (default 30) of today, soonest first, each joined with its product row. */
export async function listExpiringBatches(
  supabase: Client,
  options?: ListExpiringBatchesOptions,
): Promise<ProductBatchWithProduct[]> {
  const withinDays = options?.withinDays ?? 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  const cutoffDate = toLocalDateString(cutoff);

  const { data, error } = await supabase
    .from("product_batches")
    .select("*, product:products(*)")
    .lte("expiry_date", cutoffDate)
    .order("expiry_date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ProductBatchWithProduct[];
}

/** Clears a batch from the near-expiry list once handled (sold through or discarded). Not audit-logged — routine housekeeping, not a financial event. */
export async function deleteBatch(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("product_batches").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- batches.service`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/batches.service.ts services/batches.service.test.ts
git commit -m "feat: add batches service for near-expiry listing and clearing"
```

---

### Task 4: UI — receiving field, inventory banner, and the near-expiry page

**Files:**
- Modify: `components/features/inventory/ReceiveStockForm.tsx`
- Modify: `app/(dashboard)/inventory/page.tsx`
- Create: `app/(dashboard)/inventory/expiry/page.tsx`

**Interfaces:**
- Consumes: `recordStockPurchase` (Task 2, extended params), `listExpiringBatches`/`deleteBatch` (Task 3), `daysUntilExpiry`/`ProductBatchWithProduct` (Task 2).
- Produces: no new exports — this is the final task, ending in a full-repo verification pass.

- [ ] **Step 1: Replace `ReceiveStockForm.tsx`**

Replace the full content of `components/features/inventory/ReceiveStockForm.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordStockPurchase } from "@/services/products.service";
import { listSuppliers } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import { toBaseUnitCost, toBaseUnits } from "@/lib/units";
import { formatCurrency } from "@/lib/utils";
import type { Product, ProductUnit } from "@/types/product";
import type { SupplierWithBalance } from "@/types/supplier";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ReceiveStockFormProps {
  product: Product;
  units: ProductUnit[];
  onSaved: (updatedProduct: Product) => void;
  onCancel: () => void;
}

/** Lets an admin record a wholesale purchase (e.g. a كرتونة) and automatically break it down into base-unit stock, updating cost_price via weighted average. Admins additionally see optional supplier/invoice/payment-method fields that post to the supplier's ledger. The expiry-date field is open to both roles — it's operational housekeeping, not financial data. A cashier without admin rights sees quantity/cost/expiry only. */
export function ReceiveStockForm({ product, units, onSaved, onCancel }: ReceiveStockFormProps) {
  const { user, storeId, role } = useAuth();
  const isAdmin = role === "admin";

  const unitOptions = useMemo(
    () => [
      { value: "base", label: product.unit, factor: 1 },
      ...units.map((unit) => ({ value: unit.id, label: unit.unit_name, factor: unit.conversion_factor })),
    ],
    [product.unit, units],
  );

  const [selectedUnitValue, setSelectedUnitValue] = useState("base");
  const [purchasedQuantity, setPurchasedQuantity] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit" | "">("");

  useEffect(() => {
    if (!isAdmin) return;
    const supabase = createClient();
    listSuppliers(supabase)
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [isAdmin]);

  function handleSupplierChange(value: string) {
    setSupplierId(value);
    if (!value) setPaymentMethod("");
  }

  const baseUnitOption = { value: "base", label: product.unit, factor: 1 };
  const selectedUnit = unitOptions.find((option) => option.value === selectedUnitValue) ?? baseUnitOption;

  const quantityNumber = Number(purchasedQuantity);
  const costNumber = Number(costPerUnit);
  const isPreviewValid =
    purchasedQuantity !== "" && costPerUnit !== "" && Number.isFinite(quantityNumber) && quantityNumber > 0 && Number.isFinite(costNumber) && costNumber >= 0;

  const addedBaseUnits = isPreviewValid ? toBaseUnits(quantityNumber, selectedUnit.factor) : 0;
  const estimatedNewCost = isPreviewValid
    ? (product.quantity * product.cost_price + addedBaseUnits * toBaseUnitCost(costNumber, selectedUnit.factor)) /
      (product.quantity + addedBaseUnits)
    : 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!Number.isInteger(quantityNumber) || quantityNumber <= 0) {
      setError("الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر");
      return;
    }
    if (!Number.isFinite(costNumber) || costNumber < 0) {
      setError("سعر الشراء يجب أن يكون صفراً أو أكبر");
      return;
    }
    if (isAdmin && supplierId && !paymentMethod) {
      setError("يجب تحديد طريقة الدفع عند اختيار مورد");
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
      const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
      const updated = await recordStockPurchase(
        supabase,
        {
          productId: product.id,
          productName: product.name,
          purchasedQuantity: quantityNumber,
          unitName: selectedUnit.value === "base" ? null : selectedUnit.label,
          conversionFactor: selectedUnit.factor,
          costPerPurchasedUnit: costNumber,
          supplierId: isAdmin && supplierId ? supplierId : null,
          supplierName: isAdmin && supplierId ? (selectedSupplier?.name ?? null) : null,
          invoiceNumber: isAdmin && invoiceNumber.trim() ? invoiceNumber.trim() : null,
          paymentMethod: isAdmin && supplierId ? (paymentMethod || null) : null,
          expiryDate: expiryDate || null,
        },
        user?.id ?? null,
        storeId,
      );
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر استلام المخزون");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="receive-unit" className="text-sm font-medium text-gray-700">
          وحدة الشراء
        </label>
        <select
          id="receive-unit"
          value={selectedUnitValue}
          onChange={(event) => setSelectedUnitValue(event.target.value)}
          className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        >
          {unitOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {option.factor > 1 ? ` (= ${option.factor} ${product.unit})` : ""}
            </option>
          ))}
        </select>
      </div>

      <Input
        label={`الكمية المشتراة (${selectedUnit.label})`}
        type="number"
        min={1}
        step={1}
        value={purchasedQuantity}
        onChange={(event) => setPurchasedQuantity(event.target.value)}
        required
      />

      <Input
        label={`سعر الشراء لكل ${selectedUnit.label}`}
        type="number"
        min={0}
        step="0.01"
        value={costPerUnit}
        onChange={(event) => setCostPerUnit(event.target.value)}
        required
      />

      <Input
        label="تاريخ الصلاحية (اختياري)"
        type="date"
        value={expiryDate}
        onChange={(event) => setExpiryDate(event.target.value)}
      />

      {isAdmin ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="receive-supplier" className="text-sm font-medium text-gray-700">
              المورد (اختياري)
            </label>
            <select
              id="receive-supplier"
              value={supplierId}
              onChange={(event) => handleSupplierChange(event.target.value)}
              className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            >
              <option value="">بدون مورد</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="رقم الفاتورة (اختياري)"
            value={invoiceNumber}
            onChange={(event) => setInvoiceNumber(event.target.value)}
          />

          {supplierId ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">طريقة الدفع</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={paymentMethod === "cash" ? "primary" : "secondary"}
                  className="flex-1"
                  onClick={() => setPaymentMethod("cash")}
                >
                  نقداً
                </Button>
                <Button
                  type="button"
                  variant={paymentMethod === "credit" ? "primary" : "secondary"}
                  className="flex-1"
                  onClick={() => setPaymentMethod("credit")}
                >
                  آجل
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {isPreviewValid ? (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          سيُضاف {addedBaseUnits} {product.unit}، السعر الجديد التقديري تقريباً {formatCurrency(estimatedNewCost)}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "جارٍ الحفظ..." : "استلام"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Wire the near-expiry count into `app/(dashboard)/inventory/page.tsx`**

Make these four changes to `app/(dashboard)/inventory/page.tsx`:

1. Add an import for `listExpiringBatches`. Find:

```ts
import {
  listProducts,
  listProductsWithCategory,
  getLowStockProducts,
  deleteProduct,
  listProductUnits,
} from "@/services/products.service";
```

Add this line right after it:

```ts
import { listExpiringBatches } from "@/services/batches.service";
```

2. Add a new state variable. Find:

```ts
  const [lowStockCount, setLowStockCount] = useState(0);
```

Change it to:

```ts
  const [lowStockCount, setLowStockCount] = useState(0);
  const [expiringBatchesCount, setExpiringBatchesCount] = useState(0);
```

3. Fetch the count alongside the existing low-stock fetch. Find:

```ts
    const [productList, groupedProducts, categoryList, allCategoryList, lowStock] = await Promise.all([
      listProducts(supabase),
      listProductsWithCategory(supabase),
      listCategories(supabase),
      listCategories(supabase, { includeInactive: true }),
      getLowStockProducts(supabase),
    ]);
    setProducts(productList);
    setProductsWithCategory(groupedProducts);
    setCategories(categoryList);
    setAllCategories(allCategoryList);
    setLowStockCount(lowStock.length);
    setIsLoading(false);
```

Change it to:

```ts
    const [productList, groupedProducts, categoryList, allCategoryList, lowStock, expiringBatches] = await Promise.all([
      listProducts(supabase),
      listProductsWithCategory(supabase),
      listCategories(supabase),
      listCategories(supabase, { includeInactive: true }),
      getLowStockProducts(supabase),
      listExpiringBatches(supabase),
    ]);
    setProducts(productList);
    setProductsWithCategory(groupedProducts);
    setCategories(categoryList);
    setAllCategories(allCategoryList);
    setLowStockCount(lowStock.length);
    setExpiringBatchesCount(expiringBatches.length);
    setIsLoading(false);
```

4. Render the banner line. Find:

```tsx
          {lowStockCount > 0 ? (
            <p className="mt-1 text-sm text-red-600">{lowStockCount} منتج قارب على النفاد</p>
          ) : null}
```

Change it to:

```tsx
          {lowStockCount > 0 ? (
            <p className="mt-1 text-sm text-red-600">{lowStockCount} منتج قارب على النفاد</p>
          ) : null}
          {expiringBatchesCount > 0 ? (
            <Link href="/inventory/expiry" className="mt-1 block text-sm text-red-600">
              {expiringBatchesCount} دفعة قريبة من الصلاحية
            </Link>
          ) : null}
```

(`Link` is already imported at the top of this file — no new import needed for this step.)

- [ ] **Step 3: Create `app/(dashboard)/inventory/expiry/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { listExpiringBatches, deleteBatch } from "@/services/batches.service";
import { daysUntilExpiry } from "@/types/product";
import type { ProductBatchWithProduct } from "@/types/product";
import { formatDate, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function ExpiringBatchesPage() {
  const [batches, setBatches] = useState<ProductBatchWithProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadBatches = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const result = await listExpiringBatches(supabase);
    setBatches(result);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  async function handleDelete(id: string) {
    const supabase = createClient();
    await deleteBatch(supabase, id);
    void loadBatches();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">قريبة الصلاحية</h1>
        <Link href="/inventory" className="text-sm font-medium text-gray-600 hover:text-brand-700">
          رجوع
        </Link>
      </div>

      {isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : batches.length === 0 ? (
        <p className="p-6 text-center text-gray-400">لا توجد دفعات قريبة من الصلاحية</p>
      ) : (
        <Card className="p-0">
          <div className="flex flex-col divide-y divide-gray-100">
            {batches.map((batch) => {
              const days = daysUntilExpiry(batch.expiry_date);
              return (
                <div key={batch.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-gray-900">{batch.product_name}</p>
                    <p className="text-xs text-gray-500">
                      الكمية: {batch.quantity} — الصلاحية: {formatDate(batch.expiry_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-sm font-semibold", days < 7 ? "text-red-600" : "text-orange-500")}>
                      {days < 0 ? "منتهية" : `${days} يوم`}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => void handleDelete(batch.id)}>
                      حذف
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Full verification pass**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: PASS — this is the final task, so this is the whole-feature check (all batches/products tests plus the full existing suite, confirming nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add components/features/inventory/ReceiveStockForm.tsx "app/(dashboard)/inventory/page.tsx" "app/(dashboard)/inventory/expiry/page.tsx"
git commit -m "feat: add expiry-date field to stock receiving and a near-expiry alerts page"
```

**Manual smoke-test checklist** (for whoever picks this up after the automated pipeline, since there's no headless-browser tooling in this environment to drive it automatically):
1. As either a cashier or admin, open "استلام" on a product, confirm a "تاريخ الصلاحية (اختياري)" date field appears (for a cashier: alongside quantity/cost only, no supplier fields; for an admin: alongside all existing fields).
2. Receive stock with an expiry date ~10 days from today, confirm it succeeds.
3. On `/inventory`, confirm a "١ دفعة قريبة من الصلاحية" (or similar count) banner line appears, linking to `/inventory/expiry`.
4. Open `/inventory/expiry`, confirm the batch appears with the right product name, quantity, expiry date, and a days-remaining badge (orange, since ~10 days is under 30 but over 7).
5. Receive stock with an expiry date 60 days out, confirm it does NOT appear in the list (outside the 30-day window) and does not affect the count.
6. Receive stock with no expiry date at all, confirm nothing changes on `/inventory/expiry` or the count.
7. Click "حذف" on a batch, confirm it disappears from the list and the inventory page's count drops.
8. Confirm a cashier login can reach `/inventory/expiry` directly and delete a batch (no admin gate).
