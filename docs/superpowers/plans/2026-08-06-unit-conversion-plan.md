# Unit Conversion (Carton→Bag→Piece) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any product optionally define extra sale units (e.g. كيس = 6 قطعة, كارتون = 24 قطعة), each with its own barcode and manually-set price, while `products.quantity` keeps tracking stock as a single base-unit number — with zero changes to existing schema columns, the stock RPC signature, or any currently-shipping POS/report behavior.

**Architecture:** One new additive table `product_units` (base unit stays implicit as the `products` row itself) plus two nullable/defaulted columns on `sale_items` for historical unit snapshots. A new `resolveBarcode()` service function tries the existing `products.barcode` lookup first (unchanged fast path), falling back to `product_units.barcode` only on miss. All stock math funnels through one new pure helper, `toBaseUnits(quantity, conversionFactor)`, so the existing `adjust_product_stock` RPC never needs to change.

**Tech Stack:** Next.js 15 (App Router) + TypeScript strict + Supabase (Postgres, RLS, `@supabase/ssr`) + Tailwind. Vitest added in Task 1 as the project's first test runner.

**Spec:** `docs/superpowers/specs/2026-08-06-unit-conversion-design.md` (commit `ffd52fa`)

## Global Constraints

- `conversion_factor` is `integer` (not numeric/decimal) — must stay assignable directly as `p_delta` to the existing `adjust_product_stock(p_product_id uuid, p_delta integer)` RPC without casting.
- No changes to `products` table columns, `adjust_product_stock` signature, or `CartItem`'s existing required fields (`productId`, `name`, `barcode`, `unitPrice`, `quantity`, `availableStock`) — new fields must be optional and default to base-unit behavior when absent.
- `sale_items.unit_label` / `sale_items.unit_conversion_factor` are historical snapshots (plain columns, not FKs) — deleting/deactivating a `product_units` row must never affect past sales.
- Every new DB constraint (`CHECK (conversion_factor > 1)`, unique barcode across both tables, `ON DELETE CASCADE`) must have a corresponding test in Task 2 before being treated as done.
- Arabic UI copy/error messages throughout, matching the existing style in `hooks/usePOS.ts` and `components/features/inventory/ProductForm.tsx`.
- Follow this repo's existing soft-delete pattern (`is_active = false`, never a hard `DELETE`, e.g. `deleteProduct` in `services/products.service.ts:111`) for `deleteProductUnit`.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `vitest.config.ts` | Test runner setup (new) |
| `supabase/migrations/00000000000005_product_units.sql` | New table, cross-table barcode trigger, `sale_items` columns |
| `supabase/tests/00000000000005_product_units_test.sql` | Rollback-wrapped SQL assertions for the migration above (new) |
| `types/database.types.ts` | Add `product_units` table types; extend `sale_items` Row/Insert/Update |
| `types/product.ts` | Add `ProductUnit`/`ProductUnitInsert`/`ProductUnitUpdate` aliases |
| `lib/units.ts` | New pure helper: `toBaseUnits()` (new) |
| `types/pos.ts` | Extend `CartItem` with optional unit fields; add `productUnitToCartItem()` |
| `services/products.service.ts` | Add `resolveBarcode()`, `listProductUnits()`, `createProductUnit()`, `updateProductUnit()`, `deleteProductUnit()` |
| `services/sales.service.ts` | Extract `buildSaleItemRows()`; write new columns |
| `hooks/usePOS.ts` | Wire `resolveBarcode`/`toBaseUnits` through scan/add/update/remove/clear |
| `components/features/pos/CartGrid.tsx` | Show unit label per cart line |
| `components/features/pos/ReceiptPrinter.tsx` | Show unit label per receipt line |
| `components/features/inventory/ProductUnitsManager.tsx` | New: add/list/remove a product's extra units |
| `components/features/inventory/ProductForm.tsx` | Embed `ProductUnitsManager` when editing an existing product |

---

### Task 1: Add Vitest test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Test: `lib/smoke.test.ts` (deleted at the end of this task — it only proves the runner works)

**Interfaces:**
- Produces: `npm test` command (`vitest run`), path alias `@/*` resolving the same way it does for `tsc` (per `tsconfig.json:19-21`).

- [ ] **Step 1: Add the dependency and script**

In `package.json`, add to `"devDependencies"` (alongside the existing `typescript`/`eslint` entries):
```json
"vitest": "^2.1.8"
```
Add to `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates, no errors.

- [ ] **Step 3: Create the Vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Write a smoke test to prove the runner + alias work**

Create `lib/smoke.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("vitest setup", () => {
  it("resolves the @ path alias and runs", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run lib/smoke.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Delete the smoke test (it was only a setup check, not part of the feature)**

Run: `rm lib/smoke.test.ts`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "Add Vitest as the project's test runner"
```

---

### Task 2: `product_units` table, cross-table barcode trigger, `sale_items` columns

**Files:**
- Create: `supabase/migrations/00000000000005_product_units.sql`
- Create: `supabase/tests/00000000000005_product_units_test.sql`

**Interfaces:**
- Produces: table `product_units(id, product_id, unit_name, conversion_factor, barcode, sale_price, sort_order, is_active, created_at, updated_at)`; columns `sale_items.unit_label text null`, `sale_items.unit_conversion_factor integer not null default 1`.
- No local Postgres/Docker is available in this environment (confirmed: `docker` is not installed, no `supabase/config.toml`). Both the migration and its test run directly against the live project (`klctindutdkvsmnsegwy`) via the Supabase Management API, using `$SUPABASE_ACCESS_TOKEN` from the shell environment (already confirmed working this session). The test wraps everything in `begin ... rollback` so it never leaves data behind.

- [ ] **Step 1: Write the test script first (it will fail — the table doesn't exist yet)**

Create `supabase/tests/00000000000005_product_units_test.sql`:
```sql
-- Rollback-wrapped assertions for migration 00000000000005. Safe to run
-- against the live project any number of times: nothing here survives
-- past the final ROLLBACK.
begin;

insert into products (id, name, barcode, sale_price, quantity, unit)
values ('00000000-0000-0000-0000-000000000001', 'TEST_PRODUCT', 'TEST-BASE-0001', 10, 100, 'قطعة');

-- Test 1: conversion_factor = 1 must be rejected (CHECK conversion_factor > 1).
do $$
begin
  begin
    insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
    values ('00000000-0000-0000-0000-000000000001', 'كيس', 1, 'TEST-UNIT-0001', 20);
    raise exception 'TEST FAILED: conversion_factor=1 should have been rejected';
  exception
    when check_violation then
      raise notice 'TEST PASSED: conversion_factor=1 rejected';
  end;
end $$;

-- Test 2: a valid unit insert succeeds.
insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
values ('00000000-0000-0000-0000-000000000001', 'كيس', 6, 'TEST-UNIT-0002', 55);

-- Test 3: duplicate unit_name for the same product is rejected (UNIQUE product_id, unit_name).
do $$
begin
  begin
    insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
    values ('00000000-0000-0000-0000-000000000001', 'كيس', 12, 'TEST-UNIT-0003', 100);
    raise exception 'TEST FAILED: duplicate unit_name should have been rejected';
  exception
    when unique_violation then
      raise notice 'TEST PASSED: duplicate unit_name rejected';
  end;
end $$;

-- Test 4: a unit barcode colliding with an existing product barcode is rejected (cross-table trigger, unit -> product direction).
do $$
begin
  begin
    insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
    values ('00000000-0000-0000-0000-000000000001', 'كارتون', 24, 'TEST-BASE-0001', 200);
    raise exception 'TEST FAILED: unit barcode colliding with a product barcode should have been rejected';
  exception
    when unique_violation then
      raise notice 'TEST PASSED: cross-table barcode collision (unit -> product) rejected';
  end;
end $$;

-- Test 5: a new product barcode colliding with an existing unit barcode is rejected (cross-table trigger, product -> unit direction).
do $$
begin
  begin
    insert into products (name, barcode, sale_price)
    values ('TEST_PRODUCT_2', 'TEST-UNIT-0002', 5);
    raise exception 'TEST FAILED: product barcode colliding with a unit barcode should have been rejected';
  exception
    when unique_violation then
      raise notice 'TEST PASSED: cross-table barcode collision (product -> unit) rejected';
  end;
end $$;

-- Test 6: deleting the parent product cascades to its units.
delete from products where id = '00000000-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from product_units where product_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: product_units rows survived parent product delete';
  else
    raise notice 'TEST PASSED: ON DELETE CASCADE removed product_units rows';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails (table doesn't exist yet)**

Run:
```bash
jq -Rs '{query: .}' supabase/tests/00000000000005_product_units_test.sql | \
  curl -s -X POST "https://api.supabase.com/v1/projects/klctindutdkvsmnsegwy/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```
Expected: an error mentioning `relation "product_units" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/00000000000005_product_units.sql`:
```sql
-- Adds optional multi-level sale units (e.g. كيس, كارتون) on top of a
-- product's existing base unit (the products row itself — never
-- duplicated as a product_units row). Stock stays a single base-unit
-- number on products.quantity; conversion_factor is how many base units
-- one of this unit equals, kept as `integer` so it plugs directly into
-- the existing adjust_product_stock(uuid, integer) RPC with no cast.
create table if not exists product_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  unit_name text not null,
  conversion_factor integer not null check (conversion_factor > 1),
  barcode text not null unique,
  sale_price numeric(12, 2) not null check (sale_price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, unit_name)
);

create index if not exists product_units_product_id_idx on product_units (product_id);

alter table product_units enable row level security;
create policy "authenticated all product_units" on product_units for all to authenticated using (true) with check (true);

-- Cross-table barcode uniqueness: a UNIQUE constraint can't span two
-- tables directly, so each table gets a trigger checking the other.
-- errcode 23505 (unique_violation) is used deliberately so the existing
-- isUniqueViolation() helper in services/products.service.ts already
-- handles this without any changes.
create or replace function public.check_product_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from product_units where barcode = new.barcode) then
    raise exception 'الباركود مستخدم من قبل بوحدة منتج أخرى' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists products_barcode_cross_check on products;
create trigger products_barcode_cross_check
  before insert or update of barcode on products
  for each row execute procedure public.check_product_barcode_unique();

create or replace function public.check_unit_barcode_unique()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from products where barcode = new.barcode) then
    raise exception 'الباركود مستخدم من قبل منتج آخر' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists product_units_barcode_cross_check on product_units;
create trigger product_units_barcode_cross_check
  before insert or update of barcode on product_units
  for each row execute procedure public.check_unit_barcode_unique();

-- Historical snapshot of which unit a sale_items line was sold in.
-- Plain columns, not FKs: editing/deleting a product_units row later must
-- never change or break a past invoice. NULL unit_label means the base
-- unit (products.unit) was sold — matches every existing row.
alter table sale_items
  add column if not exists unit_label text,
  add column if not exists unit_conversion_factor integer not null default 1;
```

- [ ] **Step 4: Apply the migration to the live project**

Run:
```bash
jq -Rs '{query: .}' supabase/migrations/00000000000005_product_units.sql | \
  curl -s -X POST "https://api.supabase.com/v1/projects/klctindutdkvsmnsegwy/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```
Expected: `[]` (empty JSON array — DDL statements return no rows) and no `"message"` error field.

- [ ] **Step 5: Run the test again to verify it passes**

Run the same command from Step 2.
Expected: no error, and the response includes six `"TEST PASSED"` notices (one per test) with no `"TEST FAILED"` anywhere in the output.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00000000000005_product_units.sql supabase/tests/00000000000005_product_units_test.sql
git commit -m "Add product_units table, cross-table barcode trigger, sale_items unit snapshot columns"
```

---

### Task 3: TypeScript types for `product_units` and extended `sale_items`

**Files:**
- Modify: `types/database.types.ts:177-224` (sale_items block), and add a new `product_units` block after it (before `operations_log` at line 225)
- Modify: `types/product.ts`

**Interfaces:**
- Produces: `Database["public"]["Tables"]["product_units"]`, `ProductUnit`, `ProductUnitInsert`, `ProductUnitUpdate` (all consumed by Task 6 onward).

- [ ] **Step 1: Add `unit_label`/`unit_conversion_factor` to the `sale_items` block**

In `types/database.types.ts`, in the `sale_items` table block (currently lines 177-224), add to `Row`, `Insert`, and `Update`:
```typescript
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          product_id: string | null;
          product_name: string;
          barcode: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          unit_label: string | null;
          unit_conversion_factor: number;
        };
        Insert: {
          id?: string;
          sale_id: string;
          product_id?: string | null;
          product_name: string;
          barcode: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          unit_label?: string | null;
          unit_conversion_factor?: number;
        };
        Update: {
          id?: string;
          sale_id?: string;
          product_id?: string | null;
          product_name?: string;
          barcode?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
          unit_label?: string | null;
          unit_conversion_factor?: number;
        };
```
(Leave the `Relationships` array for `sale_items` exactly as-is.)

- [ ] **Step 2: Add the `product_units` table block**

Immediately after the `sale_items` block's closing `};` (right before the `operations_log:` key, currently line 225), insert:
```typescript
      product_units: {
        Row: {
          id: string;
          product_id: string;
          unit_name: string;
          conversion_factor: number;
          barcode: string;
          sale_price: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          unit_name: string;
          conversion_factor: number;
          barcode: string;
          sale_price: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          unit_name?: string;
          conversion_factor?: number;
          barcode?: string;
          sale_price?: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_units_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 3: Add the type aliases**

In `types/product.ts`, after the existing `Category`/`CategoryUpdate` aliases (line 9), add:
```typescript
export type ProductUnit = Database["public"]["Tables"]["product_units"]["Row"];
export type ProductUnitInsert = Database["public"]["Tables"]["product_units"]["Insert"];
export type ProductUnitUpdate = Database["public"]["Tables"]["product_units"]["Update"];
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (these are additive type-only changes; nothing consumes `product_units` yet).

- [ ] **Step 5: Commit**

```bash
git add types/database.types.ts types/product.ts
git commit -m "Add product_units and sale_items unit-snapshot types"
```

---

### Task 4: `toBaseUnits` pure helper

**Files:**
- Create: `lib/units.ts`
- Test: `lib/units.test.ts`

**Interfaces:**
- Produces: `toBaseUnits(quantity: number, conversionFactor?: number): number` — consumed by Task 6 (`resolveBarcode`'s stock-check math lives in Task 8) and Task 8 (`hooks/usePOS.ts`).

- [ ] **Step 1: Write the failing test**

Create `lib/units.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { toBaseUnits } from "@/lib/units";

describe("toBaseUnits", () => {
  it("returns the quantity unchanged when no conversion factor is given (base-unit sale)", () => {
    expect(toBaseUnits(5)).toBe(5);
  });

  it("multiplies quantity by the conversion factor for a non-base unit", () => {
    expect(toBaseUnits(2, 24)).toBe(48);
  });

  it("treats a conversion factor of 1 the same as no conversion factor", () => {
    expect(toBaseUnits(7, 1)).toBe(7);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/units.test.ts`
Expected: FAIL — `Cannot find module '@/lib/units'` (file doesn't exist yet).

- [ ] **Step 3: Implement**

Create `lib/units.ts`:
```typescript
/**
 * Converts a quantity expressed in a (possibly non-base) sale unit into
 * the equivalent base-unit stock quantity. Used everywhere stock is
 * incremented/decremented, so the atomic adjust_product_stock RPC always
 * receives a base-unit delta regardless of which unit was scanned/sold.
 */
export function toBaseUnits(quantity: number, conversionFactor = 1): number {
  return quantity * conversionFactor;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/units.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/units.ts lib/units.test.ts
git commit -m "Add toBaseUnits pure helper for unit-aware stock math"
```

---

### Task 5: Extend `CartItem` and add `productUnitToCartItem`

**Files:**
- Modify: `types/pos.ts`
- Test: `types/pos.test.ts`

**Interfaces:**
- Consumes: `Product` (`types/product.ts`), `ProductUnit` (`types/product.ts`, from Task 3).
- Produces: `CartItem.unitName?: string`, `CartItem.unitConversionFactor?: number`; `productUnitToCartItem(product: Product, unit: ProductUnit, quantity?: number): CartItem` — consumed by Task 8 (`hooks/usePOS.ts`).

- [ ] **Step 1: Write the failing test**

Create `types/pos.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { productToCartItem, productUnitToCartItem } from "@/types/pos";
import type { Product, ProductUnit } from "@/types/product";

const PRODUCT: Product = {
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
  created_at: "",
  updated_at: "",
};

describe("productToCartItem", () => {
  it("leaves unitName/unitConversionFactor undefined for a base-unit sale", () => {
    const item = productToCartItem(PRODUCT, 3);
    expect(item.unitName).toBeUndefined();
    expect(item.unitConversionFactor).toBeUndefined();
  });
});

describe("productUnitToCartItem", () => {
  it("uses the unit's own barcode and sale_price, not the product's", () => {
    const item = productUnitToCartItem(PRODUCT, CARTON_UNIT, 2);
    expect(item).toEqual({
      productId: "product-1",
      name: "علبة علك",
      barcode: "2222",
      unitPrice: 40,
      quantity: 2,
      availableStock: 50,
      unitName: "كارتون",
      unitConversionFactor: 24,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run types/pos.test.ts`
Expected: FAIL — `productUnitToCartItem is not exported` (or similar).

- [ ] **Step 3: Implement**

In `types/pos.ts`:
1. Change the import on line 2 from `import type { Product } from "./product";` to `import type { Product, ProductUnit } from "./product";`
2. In the `CartItem` interface (lines 10-18), add two optional fields after `availableStock`:
```typescript
export interface CartItem {
  productId: string;
  name: string;
  barcode: string;
  unitPrice: number;
  quantity: number;
  /** Stock remaining on hand immediately after this item was reserved (post-decrement), for display only — not used for any further stock arithmetic. */
  availableStock: number;
  /** Name of the non-base unit sold (e.g. "كارتون"). Undefined means the product's base unit. */
  unitName?: string;
  /** How many base units this line's unit equals. Undefined/1 both mean the base unit. */
  unitConversionFactor?: number;
}
```
3. After `productToCartItem` (currently lines 43-52), add:
```typescript
export function productUnitToCartItem(product: Product, unit: ProductUnit, quantity = 1): CartItem {
  return {
    productId: product.id,
    name: product.name,
    barcode: unit.barcode,
    unitPrice: unit.sale_price,
    quantity,
    availableStock: product.quantity,
    unitName: unit.unit_name,
    unitConversionFactor: unit.conversion_factor,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run types/pos.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add types/pos.ts types/pos.test.ts
git commit -m "Extend CartItem with optional unit fields, add productUnitToCartItem"
```

---

### Task 6: `resolveBarcode` and `product_units` CRUD in `products.service.ts`

**Files:**
- Modify: `services/products.service.ts`
- Test: `services/products.service.test.ts`

**Interfaces:**
- Consumes: `getProductByBarcode` (existing, `services/products.service.ts:10-20`), `ProductUnit`/`ProductUnitInsert`/`ProductUnitUpdate` (Task 3).
- Produces: `resolveBarcode(supabase, barcode): Promise<{ kind: "base"; product: Product } | { kind: "unit"; product: Product; unit: ProductUnit } | null>`, `listProductUnits(supabase, productId): Promise<ProductUnit[]>`, `createProductUnit(supabase, unit: ProductUnitInsert): Promise<ProductUnit>`, `updateProductUnit(supabase, id, patch: ProductUnitUpdate): Promise<ProductUnit>`, `deleteProductUnit(supabase, id): Promise<void>` — consumed by Task 8 (`resolveBarcode`) and Task 10 (`ProductUnitsManager`).

- [ ] **Step 1: Write the failing test**

Create `services/products.service.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBarcode } from "./products.service";
import type { Database } from "@/types/database.types";
import type { Product, ProductUnit } from "@/types/product";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run services/products.service.test.ts`
Expected: FAIL — `resolveBarcode is not exported` (or similar).

- [ ] **Step 3: Implement**

In `services/products.service.ts`, add the import for `ProductUnit`/`ProductUnitInsert`/`ProductUnitUpdate` (extend the existing line 4 import), then add these functions after `getProductByBarcode` (after line 20):
```typescript
import type { Product, ProductInsert, ProductUpdate, ProductUnit, ProductUnitInsert, ProductUnitUpdate, ProductWithCategory } from "@/types/product";
```
```typescript
/**
 * Resolves a scanned/typed barcode to either a product sold at its base
 * unit, or a product sold via one of its extra units (product_units).
 * Tries the existing fast products.barcode lookup first — unchanged for
 * every product that has no extra units — and only falls back to
 * product_units on a miss.
 */
export async function resolveBarcode(
  supabase: Client,
  barcode: string,
): Promise<{ kind: "base"; product: Product } | { kind: "unit"; product: Product; unit: ProductUnit } | null> {
  const product = await getProductByBarcode(supabase, barcode);
  if (product) return { kind: "base", product };

  const { data, error } = await supabase
    .from("product_units")
    .select("*, products!inner(*)")
    .eq("barcode", barcode)
    .eq("is_active", true)
    .eq("products.is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { products: productRow, ...unit } = data as ProductUnit & { products: Product };
  return { kind: "unit", product: productRow, unit };
}

export async function listProductUnits(supabase: Client, productId: string): Promise<ProductUnit[]> {
  const { data, error } = await supabase
    .from("product_units")
    .select("*")
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw error;
  return data ?? [];
}

export async function createProductUnit(supabase: Client, unit: ProductUnitInsert): Promise<ProductUnit> {
  const { data, error } = await supabase.from("product_units").insert(unit).select().single();
  if (error) throw error;
  return data;
}

export async function updateProductUnit(supabase: Client, id: string, patch: ProductUnitUpdate): Promise<ProductUnit> {
  const { data, error } = await supabase.from("product_units").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

/** Soft delete, matching deleteProduct's convention (line 111): keeps historical sale_items snapshots intact. */
export async function deleteProductUnit(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("product_units").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run services/products.service.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/products.service.ts services/products.service.test.ts
git commit -m "Add resolveBarcode and product_units CRUD to products.service"
```

---

### Task 7: `sales.service.ts` writes unit snapshot columns

**Files:**
- Modify: `services/sales.service.ts:54-64`
- Test: `services/sales.service.test.ts`

**Interfaces:**
- Consumes: `CartItem` (Task 5), `SaleItemInsert` (Task 3).
- Produces: `buildSaleItemRows(saleId: string, items: CartItem[]): SaleItemInsert[]` — consumed by `createSale` in the same file.

- [ ] **Step 1: Write the failing test**

Create `services/sales.service.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { buildSaleItemRows } from "./sales.service";
import type { CartItem } from "@/types/pos";

describe("buildSaleItemRows", () => {
  it("defaults unit_label to null and unit_conversion_factor to 1 for a base-unit sale", () => {
    const items: CartItem[] = [{ productId: "p1", name: "منتج", barcode: "1111", unitPrice: 10, quantity: 2, availableStock: 8 }];

    expect(buildSaleItemRows("sale-1", items)).toEqual([
      {
        sale_id: "sale-1",
        product_id: "p1",
        product_name: "منتج",
        barcode: "1111",
        quantity: 2,
        unit_price: 10,
        total_price: 20,
        unit_label: null,
        unit_conversion_factor: 1,
      },
    ]);
  });

  it("carries unitName/unitConversionFactor through for a unit sale", () => {
    const items: CartItem[] = [
      {
        productId: "p1",
        name: "منتج",
        barcode: "2222",
        unitPrice: 40,
        quantity: 1,
        availableStock: 8,
        unitName: "كارتون",
        unitConversionFactor: 24,
      },
    ];

    expect(buildSaleItemRows("sale-1", items)[0]).toMatchObject({
      unit_label: "كارتون",
      unit_conversion_factor: 24,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run services/sales.service.test.ts`
Expected: FAIL — `buildSaleItemRows is not exported`.

- [ ] **Step 3: Implement**

In `services/sales.service.ts`, replace the inline mapping (currently lines 54-62):
```typescript
  const saleItems: SaleItemInsert[] = payload.items.map((item) => ({
    sale_id: sale.id,
    product_id: item.productId,
    product_name: item.name,
    barcode: item.barcode,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.unitPrice * item.quantity,
  }));
```
with a call to a new exported function:
```typescript
  const saleItems: SaleItemInsert[] = buildSaleItemRows(sale.id, payload.items);
```
Then add the extracted function above `createSale` (before line 29), right after the imports:
```typescript
/** Pure row-building step, split out from createSale so the quantity/price/unit-snapshot math is testable without touching Supabase. */
export function buildSaleItemRows(saleId: string, items: CheckoutPayload["items"]): SaleItemInsert[] {
  return items.map((item) => ({
    sale_id: saleId,
    product_id: item.productId,
    product_name: item.name,
    barcode: item.barcode,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.unitPrice * item.quantity,
    unit_label: item.unitName ?? null,
    unit_conversion_factor: item.unitConversionFactor ?? 1,
  }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run services/sales.service.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/sales.service.ts services/sales.service.test.ts
git commit -m "Extract buildSaleItemRows, write unit snapshot columns to sale_items"
```

---

### Task 8: Wire `resolveBarcode`/`toBaseUnits` through `usePOS`

**Files:**
- Modify: `hooks/usePOS.ts`

**Interfaces:**
- Consumes: `resolveBarcode`, `productUnitToCartItem` (Tasks 5-6), `toBaseUnits` (Task 4).
- Produces: `addProductToCart(product: Product, quantity: number, unit?: ProductUnit): Promise<void>` (adds the optional third parameter — existing two-argument call sites keep working).

This task has no dedicated automated test: it's a thin composition of already-tested pure pieces (`toBaseUnits`, `productUnitToCartItem`, `resolveBarcode`) into hooks that call the Supabase-backed `decrementStock`/`incrementStock`/RPC — mocking React hook state here would just re-assert the same arithmetic those unit tests already cover, without exercising anything new. It's verified by the manual end-to-end check in Task 11.

- [ ] **Step 1: Update imports**

In `hooks/usePOS.ts`, replace line 5:
```typescript
import { decrementStock, getProductByBarcode, incrementStock } from "@/services/products.service";
```
with:
```typescript
import { decrementStock, incrementStock, resolveBarcode } from "@/services/products.service";
```
Replace line 8:
```typescript
import { findCartItemByBarcode, productToCartItem } from "@/types/pos";
```
with:
```typescript
import { findCartItemByBarcode, productToCartItem, productUnitToCartItem } from "@/types/pos";
```
Add two new imports after line 10:
```typescript
import type { ProductUnit } from "@/types/product";
import { toBaseUnits } from "@/lib/units";
```

- [ ] **Step 2: Update `addProductToCart` (currently lines 23-35) to accept an optional unit**

```typescript
  const addProductToCart = useCallback(
    async (product: Product, quantity: number, unit?: ProductUnit) => {
      setScanError(null);
      const supabase = createClient();
      const baseUnits = toBaseUnits(quantity, unit?.conversion_factor);
      const updated = await decrementStock(supabase, product.id, baseUnits);
      if (!updated) {
        setScanError(`الكمية المتوفرة من ${product.name} غير كافية`);
        return;
      }
      cart.addItem(unit ? productUnitToCartItem(updated, unit, quantity) : productToCartItem(updated, quantity));
    },
    [cart],
  );
```

- [ ] **Step 3: Update `scanBarcode` (currently lines 37-63) to use `resolveBarcode`**

```typescript
  const scanBarcode = useCallback(
    async (barcode: string) => {
      setScanError(null);
      setIsScanning(true);
      try {
        const supabase = createClient();
        const resolved = await resolveBarcode(supabase, barcode);

        if (!resolved) {
          setScanError(`لم يتم العثور على منتج بالباركود: ${barcode}`);
          return;
        }

        const { product } = resolved;
        const unit = resolved.kind === "unit" ? resolved.unit : undefined;
        const requiredBaseUnits = toBaseUnits(1, unit?.conversion_factor);

        if (product.quantity < requiredBaseUnits) {
          setScanError(`${product.name} غير متوفر في المخزون`);
          return;
        }

        await addProductToCart(product, 1, unit);
      } catch (error) {
        setScanError(error instanceof Error ? error.message : "حدث خطأ أثناء قراءة الباركود");
      } finally {
        setIsScanning(false);
      }
    },
    [addProductToCart],
  );
```

- [ ] **Step 4: Update `updateQuantity` (currently lines 65-83) to convert the delta through the cart item's own unit**

```typescript
  const updateQuantity = useCallback(
    async (barcode: string, quantity: number) => {
      const item = findCartItemByBarcode(cart.items, barcode);
      if (!item) return;
      const delta = quantity - item.quantity;
      const baseDelta = toBaseUnits(delta, item.unitConversionFactor);
      const supabase = createClient();
      if (baseDelta < 0) {
        await incrementStock(supabase, item.productId, -baseDelta);
      } else if (baseDelta > 0) {
        const updated = await decrementStock(supabase, item.productId, baseDelta);
        if (!updated) {
          setScanError(`الكمية المتوفرة من ${item.name} غير كافية`);
          return;
        }
      }
      cart.updateQuantity(barcode, quantity);
    },
    [cart],
  );
```

- [ ] **Step 5: Update `removeItem` (currently lines 85-94)**

```typescript
  const removeItem = useCallback(
    async (barcode: string) => {
      const item = findCartItemByBarcode(cart.items, barcode);
      if (!item) return;
      const supabase = createClient();
      await incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor));
      cart.removeItem(barcode);
    },
    [cart],
  );
```

- [ ] **Step 6: Update `clear` (currently lines 96-100)**

```typescript
  const clear = useCallback(async () => {
    const supabase = createClient();
    await Promise.all(
      cart.items.map((item) => incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor))),
    );
    cart.clear();
  }, [cart]);
```

- [ ] **Step 7: Typecheck and run the full test suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; all previously-written tests still pass (this task adds no new tests of its own, per the note above).

- [ ] **Step 8: Commit**

```bash
git add hooks/usePOS.ts
git commit -m "Wire resolveBarcode and unit-aware stock math through usePOS"
```

---

### Task 9: Show the unit label in the cart and on the receipt

**Files:**
- Modify: `components/features/pos/CartGrid.tsx:31-33`
- Modify: `components/features/pos/ReceiptPrinter.tsx:27-30`

**Interfaces:**
- Consumes: `CartItem.unitName` (Task 5), `SaleItem.unit_label` (Task 3).

- [ ] **Step 1: `CartGrid.tsx`**

Replace the product-name cell (currently line 32):
```tsx
              <td className="p-2 font-medium text-gray-900">{item.name}</td>
```
with:
```tsx
              <td className="p-2 font-medium text-gray-900">
                {item.name}
                {item.unitName ? <span className="mr-1 text-xs font-normal text-gray-500">({item.unitName})</span> : null}
              </td>
```

- [ ] **Step 2: `ReceiptPrinter.tsx`**

Replace the item name line (currently line 29):
```tsx
            <p>{item.product_name}</p>
```
with:
```tsx
            <p>
              {item.product_name}
              {item.unit_label ? ` (${item.unit_label})` : ""}
            </p>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/features/pos/CartGrid.tsx components/features/pos/ReceiptPrinter.tsx
git commit -m "Show unit label in cart lines and on the printed receipt"
```

---

### Task 10: `ProductUnitsManager` UI + `ProductForm` wiring

**Files:**
- Create: `components/features/inventory/ProductUnitsManager.tsx`
- Modify: `components/features/inventory/ProductForm.tsx:1-12` (imports) and `:132` (insertion point)

**Interfaces:**
- Consumes: `listProductUnits`, `createProductUnit`, `deleteProductUnit`, `isUniqueViolation` (Task 6), `ProductUnit` (Task 3).
- Produces: `<ProductUnitsManager productId={string} />`, rendered only when editing an existing product (a new product has no `id` yet to attach units to).

- [ ] **Step 1: Create the component**

Create `components/features/inventory/ProductUnitsManager.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createProductUnit,
  deleteProductUnit,
  isUniqueViolation,
  listProductUnits,
} from "@/services/products.service";
import type { ProductUnit } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ProductUnitsManagerProps {
  productId: string;
}

/** Lets a manager attach extra sale units (كيس، كارتون...) to an existing product, each with its own barcode and price. */
export function ProductUnitsManager({ productId }: ProductUnitsManagerProps) {
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [unitName, setUnitName] = useState("");
  const [conversionFactor, setConversionFactor] = useState("");
  const [barcode, setBarcode] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      setUnits(await listProductUnits(supabase, productId));
    }
    void load();
  }, [productId]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const factor = Number(conversionFactor);
    if (!Number.isInteger(factor) || factor <= 1) {
      setError("معامل التحويل يجب أن يكون عدداً صحيحاً أكبر من 1");
      return;
    }
    if (Number(salePrice) <= 0) {
      setError("سعر البيع يجب أن يكون أكبر من صفر");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      const created = await createProductUnit(supabase, {
        product_id: productId,
        unit_name: unitName,
        conversion_factor: factor,
        barcode,
        sale_price: Number(salePrice),
        sort_order: units.length,
      });
      setUnits([...units, created]);
      setUnitName("");
      setConversionFactor("");
      setBarcode("");
      setSalePrice("");
    } catch (err) {
      setError(isUniqueViolation(err) ? "الباركود مستخدم من قبل" : "تعذر إضافة الوحدة");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove(id: string) {
    const supabase = createClient();
    await deleteProductUnit(supabase, id);
    setUnits(units.filter((unit) => unit.id !== id));
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-medium text-gray-700">وحدات البيع الإضافية (كيس، كارتون...)</p>

      {units.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {units.map((unit) => (
            <li key={unit.id} className="flex items-center justify-between text-sm text-gray-700">
              <span>
                {unit.unit_name} = {unit.conversion_factor} قطعة — باركود {unit.barcode} — {unit.sale_price}
              </span>
              <button type="button" onClick={() => handleRemove(unit.id)} className="text-red-600 hover:underline">
                حذف
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleAdd} className="grid grid-cols-2 gap-2">
        <Input label="اسم الوحدة" value={unitName} onChange={(event) => setUnitName(event.target.value)} required />
        <Input
          label="معامل التحويل"
          type="number"
          min={2}
          step={1}
          value={conversionFactor}
          onChange={(event) => setConversionFactor(event.target.value)}
          required
        />
        <Input label="الباركود" value={barcode} onChange={(event) => setBarcode(event.target.value)} required />
        <Input
          label="سعر البيع"
          type="number"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          required
        />
        <Button type="submit" disabled={isSaving} className="col-span-2">
          {isSaving ? "جارٍ الإضافة..." : "إضافة وحدة"}
        </Button>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `ProductForm`**

In `components/features/inventory/ProductForm.tsx`, add the import after line 11 (`import { BarcodeGenerator } from "./BarcodeGenerator";`):
```typescript
import { ProductUnitsManager } from "./ProductUnitsManager";
```
Then, immediately after the existing unit `<Input>` (currently line 132: `<Input label="الوحدة" value={unit} onChange={(event) => setUnit(event.target.value)} />`), add:
```tsx
      {product ? <ProductUnitsManager productId={product.id} /> : null}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/features/inventory/ProductUnitsManager.tsx components/features/inventory/ProductForm.tsx
git commit -m "Add ProductUnitsManager UI, embed it in ProductForm for existing products"
```

---

### Task 11: Full build, test suite, and manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 2: Manual regression check — a product with no extra units still works exactly as before**

Start the dev server (`npm run dev`), open `/pos`, scan or type the barcode of any existing product that has no `product_units` rows. Confirm: it adds to the cart at its normal price, stock decrements by exactly the scanned quantity, and checkout/receipt look unchanged (no `(unit)` suffix shown).

- [ ] **Step 3: Manual feature check — add and sell a carton unit**

In `/inventory`, open an existing product for edit, use the new "وحدات البيع الإضافية" section to add a unit (e.g. `كارتون`, factor `24`, a barcode not used anywhere else, a sale price). Save. Go to `/pos` and scan that new barcode. Confirm: the cart line shows `(كارتون)`, the price charged is the unit's price (not `basePrice × 24`), and after checkout `products.quantity` for that product has dropped by exactly `24`.

- [ ] **Step 4: Manual check — insufficient stock for a unit sale is still blocked**

Pick a product whose current `products.quantity` is less than one unit's `conversion_factor`, scan that unit's barcode. Confirm the existing "غير متوفر في المخزون" error still shows and nothing is added to the cart.

- [ ] **Step 5: Manual check — nothing else broke**

Click through `/inventory` (StockTable, category tabs), `/sales` (daily report, trend, ranking tabs), and the archive/operations log screen. Confirm all still load and show correct data.

- [ ] **Step 6: Report results to the user**

Summarize pass/fail for each step above before considering this plan complete.
