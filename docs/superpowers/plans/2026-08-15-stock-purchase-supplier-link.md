# Link Stock Receiving to Purchase Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend dddmart's stock-receiving flow so an admin can optionally attach a supplier, invoice number, and payment method to each receipt, automatically posting the right entries to that supplier's ledger — while a cashier's receiving screen stays pixel-identical to today.

**Architecture:** A new append-only `stock_purchases` table records every receipt (supplier or not) as a permanent, queryable record. When a supplier is attached, `services/products.service.ts#recordStockPurchase` inserts `supplier_transactions` rows directly (mirroring how a POS credit sale already posts to `customer_transactions` directly, without going through the "manual entry" service functions). No change to the `receive_product_stock` RPC itself.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (`@supabase/supabase-js`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-stock-purchase-supplier-link-design.md`

## Global Constraints

- Stock receiving stays one product at a time — no batch/multi-line invoice screen.
- Supplier and invoice number are both optional and independent of each other.
- Payment method (`cash` | `credit`) is required only when a supplier is selected; the DB enforces this via a CHECK constraint, not just the UI/service layer.
- The new supplier/invoice/payment fields are admin-only (`role === "admin"`); a cashier's receiving form must be unchanged in every respect.
- No change to the `receive_product_stock` RPC — new inserts happen as follow-up service-layer steps, same non-transactional multi-insert pattern already used elsewhere in this codebase (e.g. `sales` + `sale_items`).
- `supplier_transactions` rows created by this flow are inserted directly (not via `recordSupplierPurchase`/`recordSupplierPayment`) and are NOT separately audit-logged with `supplier_purchase_recorded`/`supplier_payment_recorded` — the existing `stock_received` operations-log entry remains the one audit-trail line, extended to mention the supplier/invoice when present.
- `types/database.types.ts` is hand-authored — every migration change needs a matching manual edit there.
- Test commands: `npm run typecheck && npm run lint && npm run test && npm run build` — all must pass before each task's commit.
- Do not apply the migration to the live Supabase project and do not push to `origin/main` — both require the user's own explicit confirmation afterward, per this project's established convention.

---

### Task 1: Database schema — migration + hand-authored types

**Files:**
- Create: `supabase/migrations/00000000000017_stock_purchase_supplier_link.sql`
- Modify: `types/database.types.ts`

**Interfaces:**
- Produces: `stock_purchases` table; `supplier_transactions` gains a nullable `stock_purchase_id` column. Reuses the already-existing `PaymentMethod = "cash" | "credit"` type (`types/database.types.ts:7`, already used by `sales.payment_method`) for `stock_purchases.payment_method` — no new type alias needed.

- [ ] **Step 1: Write the migration file**

```sql
-- Links stock receiving to purchase invoices/suppliers (gap #5 in
-- docs/gaps-analysis.md, a follow-on to the suppliers feature in
-- migration 00000000000016).
--
-- stock_purchases: one row per receiving action, always recorded
-- regardless of whether a supplier was attached — a permanent,
-- queryable receipt, unlike the free-text operations_log entry that
-- was the only trace before this. quantity/cost_price are in the same
-- base-unit terms as products.quantity/cost_price (already converted
-- by the caller, same convention as receive_product_stock's own
-- parameters). total_cost = quantity * cost_price, denormalized so it
-- never needs recomputing. The CHECK constraint makes "payment_method
-- only makes sense with a supplier" a DB-level guarantee, not just a
-- UI/service-layer convention.
create table stock_purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  total_cost numeric(12, 2) not null check (total_cost >= 0),
  supplier_id uuid references suppliers (id) on delete set null,
  invoice_number text,
  payment_method text check (payment_method in ('cash', 'credit')),
  actor_id uuid references profiles (id) on delete set null,
  store_id uuid not null references stores (id),
  created_at timestamptz not null default now(),
  constraint stock_purchases_payment_method_requires_supplier
    check (
      (supplier_id is null and payment_method is null)
      or (supplier_id is not null and payment_method is not null)
    )
);

create index stock_purchases_product_id_idx on stock_purchases (product_id);
create index stock_purchases_supplier_id_idx on stock_purchases (supplier_id);
create index stock_purchases_store_id_idx on stock_purchases (store_id);
create index stock_purchases_created_at_idx on stock_purchases (created_at);

alter table stock_purchases enable row level security;

create policy "authenticated read stock_purchases" on stock_purchases for select to authenticated
  using (store_id = current_store_id());

create policy "authenticated insert stock_purchases" on stock_purchases for insert to authenticated
  with check (store_id = current_store_id());

-- supplier_transactions: link a purchase/payment row back to the
-- stock_purchases receipt that created it, same idea as
-- customer_transactions.sale_id linking a credit sale's ledger row
-- back to the sale (migration 00000000000011).
alter table supplier_transactions add column if not exists stock_purchase_id uuid references stock_purchases (id) on delete set null;
create index if not exists supplier_transactions_stock_purchase_id_idx on supplier_transactions (stock_purchase_id);
```

- [ ] **Step 2: Add the `stock_purchases` table entry**

In `types/database.types.ts`, find the `supplier_products` table block (it ends with a `Relationships: [...]` array followed by `};`, immediately before the `operations_log:` entry). Insert the following new table entry immediately after `supplier_products`'s closing `};` and before `operations_log:`:

```ts
      stock_purchases: {
        Row: {
          id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          cost_price: number;
          total_cost: number;
          supplier_id: string | null;
          invoice_number: string | null;
          payment_method: PaymentMethod | null;
          actor_id: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          cost_price: number;
          total_cost: number;
          supplier_id?: string | null;
          invoice_number?: string | null;
          payment_method?: PaymentMethod | null;
          actor_id?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          cost_price?: number;
          total_cost?: number;
          supplier_id?: string | null;
          invoice_number?: string | null;
          payment_method?: PaymentMethod | null;
          actor_id?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_purchases_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_purchases_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_purchases_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 3: Add `stock_purchase_id` to `supplier_transactions`**

In the same file, find the `supplier_transactions` table block. Its `Row` currently reads:

```ts
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
```

Change it to:

```ts
      supplier_transactions: {
        Row: {
          id: string;
          supplier_id: string;
          type: SupplierTransactionType;
          amount: number;
          note: string | null;
          stock_purchase_id: string | null;
          store_id: string;
          created_at: string;
        };
```

Its `Insert` currently reads:

```ts
        Insert: {
          id?: string;
          supplier_id: string;
          type: SupplierTransactionType;
          amount: number;
          note?: string | null;
          store_id: string;
          created_at?: string;
        };
```

Change it to:

```ts
        Insert: {
          id?: string;
          supplier_id: string;
          type: SupplierTransactionType;
          amount: number;
          note?: string | null;
          stock_purchase_id?: string | null;
          store_id: string;
          created_at?: string;
        };
```

Its `Update` currently reads:

```ts
        Update: {
          id?: string;
          supplier_id?: string;
          type?: SupplierTransactionType;
          amount?: number;
          note?: string | null;
          store_id?: string;
          created_at?: string;
        };
```

Change it to:

```ts
        Update: {
          id?: string;
          supplier_id?: string;
          type?: SupplierTransactionType;
          amount?: number;
          note?: string | null;
          stock_purchase_id?: string | null;
          store_id?: string;
          created_at?: string;
        };
```

Its `Relationships` array currently reads:

```ts
        Relationships: [
          {
            foreignKeyName: "supplier_transactions_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
```

Change it to:

```ts
        Relationships: [
          {
            foreignKeyName: "supplier_transactions_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_transactions_stock_purchase_id_fkey";
            columns: ["stock_purchase_id"];
            isOneToOne: false;
            referencedRelation: "stock_purchases";
            referencedColumns: ["id"];
          },
        ];
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00000000000017_stock_purchase_supplier_link.sql types/database.types.ts
git commit -m "feat: add stock_purchases schema and link it to supplier_transactions"
```

---

### Task 2: Extend `recordStockPurchase` with supplier/invoice/payment recording

**Files:**
- Modify: `types/product.ts`
- Modify: `services/products.service.ts`
- Modify: `services/products.service.test.ts`

**Interfaces:**
- Consumes: `stock_purchases`/`supplier_transactions.stock_purchase_id` (Task 1), the already-existing `PaymentMethod` type from `types/database.types.ts`.
- Produces: `StockPurchase`/`StockPurchaseInsert` types; `recordStockPurchase(supabase, params, actorId, storeId): Promise<Product>` with 4 new optional params (`supplierId`, `supplierName`, `invoiceNumber`, `paymentMethod`) — consumed by `ReceiveStockForm.tsx` in Task 3.

- [ ] **Step 1: Add `StockPurchase`/`StockPurchaseInsert` to `types/product.ts`**

Add these two lines to `types/product.ts`, right after the existing `ProductUnitUpdate` line:

```ts
export type StockPurchase = Database["public"]["Tables"]["stock_purchases"]["Row"];
export type StockPurchaseInsert = Database["public"]["Tables"]["stock_purchases"]["Insert"];
```

- [ ] **Step 2: Write the failing tests**

Replace the full content of `services/products.service.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllProductUnits, receiveStock, recordStockPurchase, resolveBarcode } from "./products.service";
import type { Database } from "@/types/database.types";
import type { Product, ProductUnit, StockPurchase } from "@/types/product";

const BASE_PRODUCT: Product = {
  id: "product-1",
  name: "علبة علك",
  barcode: "1111",
  category_id: null,
  cost_price: 1,
  sale_price: 2,
  quantity: 50,
  min_stock_threshold: 5,
  unit: "قطعة",
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

const CARTON_UNIT: ProductUnit = {
  id: "unit-1",
  product_id: "product-1",
  unit_name: "كارتون",
  conversion_factor: 24,
  barcode: "2222",
  sale_price: 40,
  sort_order: 0,
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

/**
 * Hand-rolled fake covering only the two chains resolveBarcode actually
 * calls: products.select().eq().eq().maybeSingle() and
 * product_units.select().eq().eq().eq().maybeSingle(). Not a general
 * Supabase mock — deliberately minimal.
 */
function createFakeSupabase(options: {
  productsRow: Product | null;
  unitRow: (ProductUnit & { products: Product }) | null;
}): SupabaseClient<Database> {
  return {
    from: (table: "products" | "product_units") => {
      const result = table === "products" ? { data: options.productsRow, error: null } : { data: options.unitRow, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("resolveBarcode", () => {
  it("returns kind 'base' when the barcode matches a product directly", async () => {
    const supabase = createFakeSupabase({ productsRow: BASE_PRODUCT, unitRow: null });
    const result = await resolveBarcode(supabase, "1111");
    expect(result).toEqual({ kind: "base", product: BASE_PRODUCT });
  });

  it("returns kind 'unit' when the barcode matches a product_units row", async () => {
    const supabase = createFakeSupabase({ productsRow: null, unitRow: { ...CARTON_UNIT, products: BASE_PRODUCT } });
    const result = await resolveBarcode(supabase, "2222");
    expect(result).toEqual({ kind: "unit", product: BASE_PRODUCT, unit: CARTON_UNIT });
  });

  it("returns null when the barcode matches nothing", async () => {
    const supabase = createFakeSupabase({ productsRow: null, unitRow: null });
    const result = await resolveBarcode(supabase, "9999");
    expect(result).toBeNull();
  });
});

/**
 * Hand-rolled fake covering only the chain listAllProductUnits actually
 * calls: product_units.select().eq(). Not a general Supabase mock —
 * deliberately minimal, matching createFakeSupabase above.
 */
function createFakeSupabaseForUnits(units: ProductUnit[]): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: units, error: null }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("listAllProductUnits", () => {
  it("returns all active product units", async () => {
    const supabase = createFakeSupabaseForUnits([CARTON_UNIT]);
    const result = await listAllProductUnits(supabase);
    expect(result).toEqual([CARTON_UNIT]);
  });

  it("returns an empty array when there are none", async () => {
    const supabase = createFakeSupabaseForUnits([]);
    const result = await listAllProductUnits(supabase);
    expect(result).toEqual([]);
  });
});

const INSERTED_STOCK_PURCHASE: StockPurchase = {
  id: "purchase-1",
  product_id: "product-1",
  product_name: "علبة علك",
  quantity: 10,
  cost_price: 1.5,
  total_cost: 15,
  supplier_id: null,
  invoice_number: null,
  payment_method: null,
  actor_id: "user-1",
  store_id: "store-1",
  created_at: "",
};

/**
 * Hand-rolled fake covering receiveStock's rpc() call and
 * recordStockPurchase's follow-up inserts: stock_purchases (needs
 * .select().single(), returns insertedStockPurchase), supplier_transactions
 * (plain insert, no chain), and operations_log (plain insert). Routed by
 * table name since each needs a different chain shape. Deliberately
 * minimal, matching the other fakes in this file.
 */
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
} {
  const rpcSpy = vi.fn(async () => ({ data: options.rpcData, error: options.rpcError ?? null }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));
  const stockPurchaseInsertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedStockPurchase ?? INSERTED_STOCK_PURCHASE, error: null }),
    }),
  }));
  const supplierTransactionInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "stock_purchases") return { insert: stockPurchaseInsertSpy };
      if (table === "supplier_transactions") return { insert: supplierTransactionInsertSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, logInsertSpy, stockPurchaseInsertSpy, supplierTransactionInsertSpy };
}

const RECEIVED_PRODUCT: Product = { ...BASE_PRODUCT, quantity: 74, cost_price: 1.5 };

describe("receiveStock", () => {
  it("builds the correct RPC args and returns the updated product", async () => {
    const { supabase, rpcSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    const result = await receiveStock(supabase, "product-1", 24, 1.5);
    expect(rpcSpy).toHaveBeenCalledWith("receive_product_stock", {
      p_product_id: "product-1",
      p_added_base_units: 24,
      p_unit_base_cost: 1.5,
    });
    expect(result).toEqual(RECEIVED_PRODUCT);
  });

  it("returns null when the RPC returns an empty array", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: [] });
    const result = await receiveStock(supabase, "product-1", 24, 1.5);
    expect(result).toBeNull();
  });

  it("throws when the RPC returns an error", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: null, rpcError: new Error("boom") });
    await expect(receiveStock(supabase, "product-1", 24, 1.5)).rejects.toThrow("boom");
  });
});

describe("recordStockPurchase", () => {
  it("passes a base-unit purchase (factor 1) through unchanged", async () => {
    const { supabase, rpcSpy, logInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    const result = await recordStockPurchase(
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
    expect(rpcSpy).toHaveBeenCalledWith("receive_product_stock", {
      p_product_id: "product-1",
      p_added_base_units: 10,
      p_unit_base_cost: 1.5,
    });
    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "stock_received", user_id: "user-1", store_id: "store-1" }),
    );
    expect(result).toEqual(RECEIVED_PRODUCT);
  });

  it("multiplies quantity and divides cost for a carton purchase (factor 24)", async () => {
    const { supabase, rpcSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 2,
        unitName: "كارتون",
        conversionFactor: 24,
        costPerPurchasedUnit: 36,
      },
      "user-1",
      "store-1",
    );
    expect(rpcSpy).toHaveBeenCalledWith("receive_product_stock", {
      p_product_id: "product-1",
      p_added_base_units: 48,
      p_unit_base_cost: 1.5,
    });
  });

  it("throws a friendly Arabic error when the RPC returns no rows", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: [] });
    await expect(
      recordStockPurchase(
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
      ),
    ).rejects.toThrow("تعذر استلام المخزون");
  });

  it("always inserts a stock_purchases row, even with no supplier", async () => {
    const { supabase, stockPurchaseInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
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
    expect(stockPurchaseInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: "product-1",
        quantity: 10,
        cost_price: 1.5,
        total_cost: 15,
        supplier_id: null,
        payment_method: null,
        store_id: "store-1",
      }),
    );
  });

  it("rejects a supplier without a payment method", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await expect(
      recordStockPurchase(
        supabase,
        {
          productId: "product-1",
          productName: "علبة علك",
          purchasedQuantity: 10,
          unitName: null,
          conversionFactor: 1,
          costPerPurchasedUnit: 1.5,
          supplierId: "supplier-1",
        },
        "user-1",
        "store-1",
      ),
    ).rejects.toThrow("يجب تحديد طريقة الدفع عند اختيار مورد");
  });

  it("with a supplier and cash payment, inserts a purchase row and a matching payment row", async () => {
    const { supabase, supplierTransactionInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
        supplierId: "supplier-1",
        supplierName: "شركة الفرات",
        invoiceNumber: "INV-1",
        paymentMethod: "cash",
      },
      "user-1",
      "store-1",
    );
    expect(supplierTransactionInsertSpy).toHaveBeenCalledTimes(2);
    expect(supplierTransactionInsertSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ supplier_id: "supplier-1", type: "purchase", amount: 15, stock_purchase_id: "purchase-1" }),
    );
    expect(supplierTransactionInsertSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ supplier_id: "supplier-1", type: "payment", amount: 15, stock_purchase_id: "purchase-1" }),
    );
  });

  it("with a supplier and credit payment, inserts only a purchase row", async () => {
    const { supabase, supplierTransactionInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
        supplierId: "supplier-1",
        paymentMethod: "credit",
      },
      "user-1",
      "store-1",
    );
    expect(supplierTransactionInsertSpy).toHaveBeenCalledTimes(1);
    expect(supplierTransactionInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ supplier_id: "supplier-1", type: "purchase", amount: 15 }),
    );
  });

  it("with no supplier, never touches supplier_transactions", async () => {
    const { supabase, supplierTransactionInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
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
    expect(supplierTransactionInsertSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `npm run test -- products.service`
Expected: the pre-existing tests (`resolveBarcode`, `listAllProductUnits`, `receiveStock`, and the first 3 `recordStockPurchase` tests) still PASS unchanged (the fake's shape didn't change for what they use); the 5 new tests FAIL because `recordStockPurchase` doesn't yet accept `supplierId`/`supplierName`/`invoiceNumber`/`paymentMethod` or insert into `stock_purchases`/`supplier_transactions`.

- [ ] **Step 4: Implement the extended `recordStockPurchase`**

In `services/products.service.ts`, replace the existing `recordStockPurchase` function (and the comment directly above it) with:

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
}

/**
 * Records a purchase of stock-by-pack: converts the purchased quantity and
 * per-unit cost into base-unit terms, calls receiveStock, always inserts a
 * stock_purchases row (the permanent receipt record), and — only when a
 * supplier is attached — posts directly to supplier_transactions (a
 * 'purchase' row, plus an immediate matching 'payment' row when paid
 * cash). These supplier_transactions inserts are NOT routed through
 * recordSupplierPurchase/recordSupplierPayment and are not separately
 * audit-logged — same reasoning as a POS credit sale posting directly to
 * customer_transactions. Finally logs one stock_received audit entry,
 * mentioning the supplier/invoice when present. This is the function the
 * UI calls. Throws if the product wasn't found, the RPC's guards rejected
 * the input, or a supplier was given without a payment method.
 */
export async function recordStockPurchase(
  supabase: Client,
  params: RecordStockPurchaseParams,
  actorId: string | null,
  storeId: string,
): Promise<Product> {
  if (params.supplierId && !params.paymentMethod) {
    throw new Error("يجب تحديد طريقة الدفع عند اختيار مورد");
  }

  const addedBaseUnits = toBaseUnits(params.purchasedQuantity, params.conversionFactor);
  const unitBaseCost = toBaseUnitCost(params.costPerPurchasedUnit, params.conversionFactor);
  const totalCost = Math.round(addedBaseUnits * unitBaseCost * 100) / 100;

  const updated = await receiveStock(supabase, params.productId, addedBaseUnits, unitBaseCost);
  if (!updated) throw new Error("تعذر استلام المخزون — تحقق من القيم المدخلة");

  const { data: purchase, error: purchaseError } = await supabase
    .from("stock_purchases")
    .insert({
      product_id: params.productId,
      product_name: params.productName,
      quantity: addedBaseUnits,
      cost_price: unitBaseCost,
      total_cost: totalCost,
      supplier_id: params.supplierId ?? null,
      invoice_number: params.invoiceNumber ?? null,
      payment_method: params.supplierId ? (params.paymentMethod ?? null) : null,
      actor_id: actorId,
      store_id: storeId,
    })
    .select()
    .single();
  if (purchaseError) throw purchaseError;

  if (params.supplierId) {
    const transactionNote = params.invoiceNumber
      ? `فاتورة رقم ${params.invoiceNumber} — ${params.purchasedQuantity} ${params.unitName ?? updated.unit} من "${params.productName}"`
      : `شراء ${params.purchasedQuantity} ${params.unitName ?? updated.unit} من "${params.productName}"`;

    const { error: purchaseTxnError } = await supabase.from("supplier_transactions").insert({
      supplier_id: params.supplierId,
      type: "purchase",
      amount: totalCost,
      note: transactionNote,
      stock_purchase_id: purchase.id,
      store_id: storeId,
    });
    if (purchaseTxnError) throw purchaseTxnError;

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

Add `PaymentMethod` to the existing `import type { Database } from "@/types/database.types";` line at the top of the file — change it to:

```ts
import type { Database, PaymentMethod } from "@/types/database.types";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- products.service`
Expected: PASS (all 13 tests: 3 `resolveBarcode` + 2 `listAllProductUnits` + 3 `receiveStock` + 8 `recordStockPurchase`)

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add types/product.ts services/products.service.ts services/products.service.test.ts
git commit -m "feat: post stock receipts to supplier ledger when a supplier is attached"
```

---

### Task 3: `ReceiveStockForm` — admin-only supplier/invoice/payment fields

**Files:**
- Modify: `components/features/inventory/ReceiveStockForm.tsx`

**Interfaces:**
- Consumes: `recordStockPurchase` (Task 2, extended params), `listSuppliers` (existing, `services/suppliers.service.ts`), `SupplierWithBalance` (existing, `types/supplier.ts`), `role` from `useAuth()` (existing).
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

/** Lets an admin record a wholesale purchase (e.g. a كرتونة) and automatically break it down into base-unit stock, updating cost_price via weighted average. Admins additionally see optional supplier/invoice/payment-method fields that post to the supplier's ledger; a cashier sees only quantity/cost, unchanged from before. */
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

- [ ] **Step 2: Full verification pass**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: PASS — this is the final task, so this is the whole-feature check (all products-service tests plus the full existing suite, confirming nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add components/features/inventory/ReceiveStockForm.tsx
git commit -m "feat: add admin-only supplier/invoice/payment fields to stock receiving"
```

**Manual smoke-test checklist** (for whoever picks this up after the automated pipeline, since there's no headless-browser tooling in this environment to drive it automatically):
1. Log in as a cashier, open a product's "استلام" form, confirm it looks and behaves exactly as before (quantity + cost only, no new fields visible).
2. Log in as admin, open "استلام" on a product, confirm the supplier dropdown, invoice number field, and (once a supplier is picked) the نقداً/آجل toggle all appear.
3. Receive stock with no supplier selected — confirm it succeeds exactly as before and nothing changes on `/suppliers`.
4. Receive stock choosing a supplier and نقداً — confirm the supplier's balance on `/suppliers` is unchanged, but its ledger now shows both a purchase and a payment line, and the note mentions the invoice number if one was entered.
5. Receive stock choosing a supplier and آجل — confirm the supplier's balance rises by exactly the purchase total.
6. From `/suppliers`, settle that debt with the existing "تسجيل دفعة" action and confirm it still works unchanged.
7. Try submitting with a supplier selected but no payment method chosen — confirm the form blocks submission with the Arabic error before any network call.
