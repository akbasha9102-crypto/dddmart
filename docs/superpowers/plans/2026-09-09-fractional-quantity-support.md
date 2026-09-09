# Fractional Quantity Support (Frontend + Math) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the cashier/admin mark a product as sold by weight and enter fractional (up to 3-decimal) quantities for it throughout the POS/inventory UI, with client-side money math that exactly matches the server's per-line rounding.

**Architecture:** The database layer (column types, RPC signatures) is already implemented and live (migration `00000000000044`, commit `af869d6`) — this plan covers only the two remaining layers from the spec: a `sold_by_weight`-aware frontend (types, product-creation forms, POS cart UI, inventory display) and a rounding-consistency fix in the client's money math (`calculateTotals`, the offline receipt line total). Every quantity-typed value already flows through as a plain TypeScript `number` (Postgres `numeric` serializes as a JSON number, confirmed live this session), so no data-layer plumbing changes are needed — only UI branching on the new `sold_by_weight`/`soldByWeight` flag and two small rounding-safe helper functions.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Vitest, existing hand-authored `types/database.types.ts`.

**Spec:** `docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md`

## Global Constraints

- Precision: quantities round to 3 decimals (`numeric(10,3)` already live), money rounds to 2 decimals — copied verbatim from the spec.
- Weight entry is manual only — no barcode-embedded-weight parsing (spec "Out of scope").
- A weighed product sells only in its own base unit — no `product_units` participation in this version (spec "Goals").
- Count-based products (`sold_by_weight === false`, the default) must keep today's whole-number-only UX exactly as is — no visible behavior change for any existing product.
- This repo has **no React component test harness** (confirmed via repo-wide search: zero `.test.tsx` files exist; the only `.test.ts` files under `components/` test extracted pure functions, not rendering). Every task below that touches a `.tsx` component is verified via `npm run typecheck && npm run lint && npm run build`, not an automated render test — this matches the repo's existing convention, not a gap in this plan.
- Every task ends with `npm run typecheck && npm run lint && npm run test` passing before commit; the final task additionally runs `npm run build`.
- Commit locally after each task; do not push to `origin/main` (per this project's standing convention — pushes get their own separate confirmation from the client).

---

### Task 1: Types — `sold_by_weight` end to end

**Files:**
- Modify: `types/database.types.ts:139-194` (products table `Row`/`Insert`/`Update`)
- Modify: `types/pos.ts` (`CartItem` interface, `productToCartItem`, `productUnitToCartItem`)
- Modify: `types/pos.test.ts` (existing `PRODUCT` fixture needs the new required field, plus a new test)

**Interfaces:**
- Produces: `Product.sold_by_weight: boolean` (via `Database["public"]["Tables"]["products"]["Row"]`), `CartItem.soldByWeight: boolean`. Every later task that reads a product's weight-ness uses these exact names.

- [ ] **Step 1: Add `sold_by_weight` to the products table type**

In `types/database.types.ts`, inside the `products` block (starts at line 139), add `sold_by_weight: boolean;` to all three shapes. `Row` gets it as a plain required field (the column is `not null`); `Insert`/`Update` get it as optional (the column has a DB default of `false`):

```typescript
      products: {
        Row: {
          id: string;
          name: string;
          barcode: string;
          category_id: string | null;
          cost_price: number;
          sale_price: number;
          quantity: number;
          min_stock_threshold: number;
          unit: string;
          sold_by_weight: boolean;
          is_active: boolean;
          store_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          barcode: string;
          category_id?: string | null;
          cost_price?: number;
          sale_price: number;
          quantity?: number;
          min_stock_threshold?: number;
          unit?: string;
          sold_by_weight?: boolean;
          is_active?: boolean;
          store_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          barcode?: string;
          category_id?: string | null;
          cost_price?: number;
          sale_price?: number;
          quantity?: number;
          min_stock_threshold?: number;
          unit?: string;
          sold_by_weight?: boolean;
          is_active?: boolean;
          store_id?: string;
          created_at?: string;
          updated_at?: string;
        };
```

(Leave `Relationships` and everything after the `products` block untouched.)

- [ ] **Step 2: Add `soldByWeight` to `CartItem` and thread it through both constructors**

In `types/pos.ts`, update the `CartItem` interface and both constructor functions:

```typescript
export interface CartItem {
  productId: string;
  name: string;
  barcode: string;
  unitPrice: number;
  /** Cost price snapshotted at add-to-cart time — permanent once the sale is recorded, unaffected by later changes to the product's cost_price. */
  costPrice: number;
  quantity: number;
  /** Last-known stock at the moment this item was added to the cart — advisory only, not a live reservation; the server re-validates and does the real check-and-decrement at checkout/hold time (create_sale_atomic / hold_sale). For display only — not used for any further stock arithmetic. */
  availableStock: number;
  /** Name of the non-base unit sold (e.g. "كارتون"). Undefined means the product's base unit. */
  unitName?: string;
  /** How many base units this line's unit equals. Undefined/1 both mean the base unit. */
  unitConversionFactor?: number;
  /** Copied from products.sold_by_weight at add-to-cart time — determines whether the cart/checkout UI offers a fractional weight input or the integer +/- stepper for this line. */
  soldByWeight: boolean;
}
```

```typescript
export function productToCartItem(product: Product, quantity = 1): CartItem {
  return {
    productId: product.id,
    name: product.name,
    barcode: product.barcode,
    unitPrice: product.sale_price,
    costPrice: product.cost_price,
    quantity,
    availableStock: product.quantity,
    soldByWeight: product.sold_by_weight,
  };
}

export function productUnitToCartItem(product: Product, unit: ProductUnit, quantity = 1): CartItem {
  return {
    productId: product.id,
    name: product.name,
    barcode: unit.barcode,
    unitPrice: unit.sale_price,
    costPrice: product.cost_price * unit.conversion_factor,
    quantity,
    availableStock: product.quantity,
    unitName: unit.unit_name,
    unitConversionFactor: unit.conversion_factor,
    soldByWeight: product.sold_by_weight,
  };
}
```

(A weighed product doesn't participate in `product_units` per the spec's scope, but `productUnitToCartItem` still copies the flag through for type-completeness and so nothing silently defaults to `undefined`.)

- [ ] **Step 3: Update the existing test fixture and add a coverage test**

`types/pos.test.ts`'s `PRODUCT` fixture will fail to typecheck once `sold_by_weight` becomes a required `Row` field. Add it:

```typescript
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
  sold_by_weight: false,
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};
```

Add a new test near the existing `productToCartItem`/`productUnitToCartItem` tests:

```typescript
describe("soldByWeight propagation", () => {
  it("copies sold_by_weight from the product into the cart item", () => {
    const weighedProduct: Product = { ...PRODUCT, sold_by_weight: true };
    expect(productToCartItem(weighedProduct, 1.25).soldByWeight).toBe(true);
    expect(productToCartItem(PRODUCT, 1).soldByWeight).toBe(false);
  });

  it("copies sold_by_weight through productUnitToCartItem too", () => {
    const weighedProduct: Product = { ...PRODUCT, sold_by_weight: true };
    expect(productUnitToCartItem(weighedProduct, CARTON_UNIT, 1).soldByWeight).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test -- types/pos.test.ts`
Expected: typecheck passes with 0 errors; all tests in `types/pos.test.ts` pass, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add types/database.types.ts types/pos.ts types/pos.test.ts
git commit -m "$(cat <<'EOF'
إضافة sold_by_weight لأنواع المنتج وعنصر السلة

تجهيز طبقة الأنواع لدعم الكميات الكسرية (البيع بالوزن) — أول خطوة من خطة
تنفيذ docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 2: `roundMoney` and `roundQuantity` helpers

**Files:**
- Modify: `lib/utils.ts`
- Modify: `lib/utils.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `roundMoney(value: number): number`, `roundQuantity(value: number): number` — used by Task 4 (`calculateTotals`), Task 5 (`usePOS.ts`), Task 8 (`ManualProductPicker.tsx`), Task 9 (`CartGrid.tsx`).

- [ ] **Step 1: Write the failing tests**

Add to `lib/utils.test.ts`:

```typescript
import { roundMoney, roundQuantity } from "@/lib/utils";

describe("roundMoney", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundMoney(12.345)).toBe(12.35);
    expect(roundMoney(12.344)).toBe(12.34);
  });

  it("avoids the classic JS binary-float rounding glitch", () => {
    // Math.round(1.005 * 100) / 100 naively evaluates to 1 in plain JS
    // because 1.005 is not exactly representable in binary floating point.
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it("leaves an already-2-decimal value unchanged", () => {
    expect(roundMoney(42.5)).toBe(42.5);
  });

  it("handles a fractional-quantity line total (the actual bug this fixes)", () => {
    // 1.257 كغم * 3450.75 د.ع/كغم = 4337.79... — must match what
    // create_sale_atomic's round(v_unit_price * v_quantity, 2) computes.
    expect(roundMoney(1.257 * 3450.75)).toBe(4337.79);
  });
});

describe("roundQuantity", () => {
  it("rounds to 3 decimal places", () => {
    expect(roundQuantity(1.2345)).toBe(1.235);
    expect(roundQuantity(1.2344)).toBe(1.234);
  });

  it("cleans up small float-drift artifacts", () => {
    expect(roundQuantity(1.2000000000000002)).toBe(1.2);
  });

  it("leaves a whole number unchanged", () => {
    expect(roundQuantity(5)).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/utils.test.ts`
Expected: FAIL — `roundMoney`/`roundQuantity` are not exported from `@/lib/utils`.

- [ ] **Step 3: Implement the helpers**

Add to `lib/utils.ts`, near `formatCurrency`:

```typescript
/**
 * Rounds a money value to 2 decimal places, matching Postgres
 * `round(numeric, 2)`'s round-half-away-from-zero behavior for the
 * always-non-negative amounts this app computes. The `Number.EPSILON`
 * nudge avoids the classic JS binary-float glitch where
 * `Math.round(1.005 * 100)` evaluates to 100 instead of 101 because 1.005
 * isn't exactly representable in IEEE754 double precision.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Rounds a quantity to 3 decimal places, matching the DB's
 * numeric(10,3) precision for weighed-product quantities — applied
 * immediately when a weight is typed in, so no small float-drift
 * artifact (e.g. 1.2000000000000002) ever reaches cart state or a
 * checkout payload.
 */
export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm test -- lib/utils.test.ts`
Expected: PASS — all `roundMoney`/`roundQuantity` tests green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/utils.ts lib/utils.test.ts
git commit -m "$(cat <<'EOF'
إضافة roundMoney وroundQuantity لدعم دقة الكميات الكسرية

دالتان نقيتان تطبقان نفس منطق تقريب قاعدة البيانات (round(numeric,2)
للمبالغ، numeric(10,3) للكميات) على جانب العميل — جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 3: `formatQuantity` display helper

**Files:**
- Modify: `lib/utils.ts`
- Modify: `lib/utils.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `formatQuantity(quantity: number, soldByWeight: boolean, unit: string): string` — used by Task 8 (`ManualProductPicker.tsx`) and Task 10 (`StockTable.tsx`, `CategoryProductList.tsx`).

- [ ] **Step 1: Write the failing tests**

Add to `lib/utils.test.ts`. Task 2 already added a `roundMoney`/`roundQuantity` import line from `@/lib/utils` to this file — extend that same line to include `formatQuantity` rather than adding a second import statement from the same module:

```typescript
import { formatQuantity, roundMoney, roundQuantity } from "@/lib/utils";
```

```typescript
describe("formatQuantity", () => {
  it("shows a count-based quantity as a plain integer, ignoring the unit", () => {
    expect(formatQuantity(12, false, "قطعة")) .toBe("12");
  });

  it("shows a weighed quantity with the unit label appended", () => {
    expect(formatQuantity(4.5, true, "كغم")).toBe("4.5 كغم");
  });

  it("trims trailing zeros for a weighed quantity", () => {
    expect(formatQuantity(2, true, "كغم")).toBe("2 كغم");
    expect(formatQuantity(1.25, true, "كغم")).toBe("1.25 كغم");
    expect(formatQuantity(1.250, true, "كغم")).toBe("1.25 كغم");
  });

  it("keeps up to 3 decimal places for a weighed quantity when needed", () => {
    expect(formatQuantity(1.234, true, "كغم")).toBe("1.234 كغم");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/utils.test.ts`
Expected: FAIL — `formatQuantity` is not exported from `@/lib/utils`.

- [ ] **Step 3: Implement the helper**

Add to `lib/utils.ts`:

```typescript
/**
 * Displays a product quantity for the UI. Count-based products (the vast
 * majority, and every product before this feature shipped) show as a
 * plain integer, unit omitted — unchanged from today's behavior. Weighed
 * products show up to 3 decimal places with trailing zeros trimmed (e.g.
 * 1.250 -> "1.25") and the product's own unit label appended (e.g. "كغم"),
 * so the display never claims false gram-level precision the store owner
 * didn't actually enter.
 */
export function formatQuantity(quantity: number, soldByWeight: boolean, unit: string): string {
  if (!soldByWeight) {
    return String(quantity);
  }
  const trimmed = Number(quantity.toFixed(3)).toString();
  return `${trimmed} ${unit}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm test -- lib/utils.test.ts`
Expected: PASS — all `formatQuantity` tests green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/utils.ts lib/utils.test.ts
git commit -m "$(cat <<'EOF'
إضافة formatQuantity لعرض الكميات الكسرية بشكل نظيف

جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 4: Per-line rounding in `calculateTotals`

**Files:**
- Modify: `types/pos.ts:85-89`
- Modify: `types/pos.test.ts`

**Interfaces:**
- Consumes: `roundMoney` (Task 2).
- Produces: `calculateTotals`'s existing signature is unchanged — this task only changes its internal arithmetic, so no other file needs to change.

- [ ] **Step 1: Write the failing test**

Add to `types/pos.test.ts` (the file already imports `calculateTotals` and the `CartItem` type at the top — no new import needed for this test):

```typescript
describe("calculateTotals — per-line rounding for fractional quantities", () => {
  it("rounds each line to the nearest fils before summing, matching create_sale_atomic's algorithm", () => {
    // Two weighed lines whose raw (unrounded) products would sum to a
    // different total than summing the two ALREADY-rounded line totals —
    // create_sale_atomic (migration 42) rounds v_unit_price * v_quantity
    // PER LINE before adding into v_subtotal, so the client must too.
    const items: CartItem[] = [
      {
        productId: "p1",
        name: "دجاج",
        barcode: "1111",
        unitPrice: 3450.75,
        costPrice: 3000,
        quantity: 1.257,
        availableStock: 50,
        soldByWeight: true,
      },
      {
        productId: "p2",
        name: "سكر",
        barcode: "2222",
        unitPrice: 1250.33,
        costPrice: 1000,
        quantity: 0.834,
        availableStock: 50,
        soldByWeight: true,
      },
    ];

    // Per-line rounded: round(3450.75 * 1.257, 2) = 4337.79, round(1250.33 * 0.834, 2) = 1042.78
    // Sum of rounded lines: 4337.79 + 1042.78 = 5380.57
    const { subtotal } = calculateTotals(items, 0);
    expect(subtotal).toBe(5380.57);
  });

  it("still sums whole-number-quantity lines exactly as before (regression guard)", () => {
    const items: CartItem[] = [
      {
        productId: "p1",
        name: "علبة علك",
        barcode: "1111",
        unitPrice: 2,
        costPrice: 1,
        quantity: 3,
        availableStock: 50,
        soldByWeight: false,
      },
    ];
    expect(calculateTotals(items, 0).subtotal).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types/pos.test.ts`
Expected: FAIL — the new fractional-quantity test's expected subtotal (`5380.57`) does not match the un-rounded-per-line sum the current implementation produces.

- [ ] **Step 3: Implement the fix**

In `types/pos.ts`, import `roundMoney` and update `calculateTotals`:

```typescript
import { roundMoney } from "@/lib/utils";

// ...

export function calculateTotals(items: CartItem[], discountAmount = 0): CartTotals {
  const subtotal = items.reduce((sum, item) => sum + roundMoney(item.unitPrice * item.quantity), 0);
  const totalAmount = Math.max(subtotal - discountAmount, 0);
  return { subtotal, discountAmount, totalAmount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm test -- types/pos.test.ts`
Expected: PASS — both new tests green, and every pre-existing `calculateTotals`/`productToCartItem` test in this file still passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add types/pos.ts types/pos.test.ts
git commit -m "$(cat <<'EOF'
تقريب كل سطر بالسلة قبل الجمع في calculateTotals

يطابق بالضبط خوارزمية create_sale_atomic (round لكل سطر قبل الجمع) —
يمنع فرق فلس نادر بين مجموع الواجهة/إيصال الأوفلاين والمبلغ الحقيقي
المسجَّل بالسيرفر عند وجود كميات كسرية. جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 5: Per-line rounding in the offline receipt line total

**Files:**
- Modify: `hooks/usePOS.ts:215`

**Interfaces:**
- Consumes: `roundMoney` (Task 2).
- Produces: nothing new — this is a leaf change to one field's computation.

There is no `usePOS.test.ts` in this repo (confirmed via `find` — hook-level tests don't exist for this file), so this task is verified via typecheck/lint/build plus a manual read-through, consistent with how this exact file's behavior was verified in this session's earlier stock-decrement-timing change.

- [ ] **Step 1: Make the change**

In `hooks/usePOS.ts`, modify the existing `import { generateInvoiceNumber } from "@/lib/utils";` line in place, and update line 215:

```typescript
import { generateInvoiceNumber, roundMoney } from "@/lib/utils";
```

```typescript
              total_price: roundMoney(item.unitPrice * item.quantity),
```

(This is inside `checkout`'s offline branch, in the `items: cart.items.map((item, index) => ({ ... }))` block that builds the local `CompletedSale` receipt.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add hooks/usePOS.ts
git commit -m "$(cat <<'EOF'
تقريب سطر إيصال البيع أوفلاين بنفس منطق قاعدة البيانات

جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 6: `ProductForm.tsx` — sold_by_weight checkbox + barcode fix

**Files:**
- Modify: `components/features/inventory/ProductForm.tsx`

**Interfaces:**
- Consumes: `Product.sold_by_weight` (Task 1).
- Produces: nothing new for later tasks — this is a leaf UI change.

No automated test (no component test harness in this repo — see Global Constraints). Verified via typecheck/lint/build plus the manual smoke-test description at the end of this task.

- [ ] **Step 1: Add `sold_by_weight` state and thread it into the payload**

In `components/features/inventory/ProductForm.tsx`, add state near the other `useState` calls (after the `unit` state, line 34):

```typescript
  const [unit, setUnit] = useState(product?.unit ?? "قطعة");
  const [soldByWeight, setSoldByWeight] = useState(product?.sold_by_weight ?? false);
```

In `handleSubmit`'s payload (around line 87-96), add the field:

```typescript
      const payload = {
        name,
        barcode: barcode.trim() || generateBarcode(),
        category_id: categoryId || null,
        cost_price: Number(costPrice) || 0,
        sale_price: Number(salePrice) || 0,
        quantity: Number(quantity) || 0,
        min_stock_threshold: Number(minStock) || 0,
        unit,
        sold_by_weight: soldByWeight,
      };
```

- [ ] **Step 2: Fix the barcode silent-fail (E2E finding #2) by reusing `QuickAddProductForm`'s already-proven pattern**

`components/features/inventory/QuickAddProductForm.tsx` already solves this exact problem — barcode is optional there (`required={false}` on `BarcodeGenerator`) and falls back to an auto-generated one on submit (`barcode.trim() || generateBarcode()`, already written into Step 1's payload above). Apply the same two changes here, so an empty barcode field just works instead of silently blocking the "حفظ" button with no message:

Modify the existing `import { BarcodeGenerator } from "./BarcodeGenerator";` line in place to also import `generateBarcode`:

```typescript
import { BarcodeGenerator, generateBarcode } from "./BarcodeGenerator";
```

Pass `required={false}` at the call site (currently line 116):

```typescript
        <BarcodeGenerator value={barcode} onChange={setBarcode} required={false} />
```

- [ ] **Step 3: Add the checkbox and make quantity/threshold fields fraction-aware**

Add a checkbox right after the "الوحدة" input (currently line 177):

```typescript
        <Input label="الوحدة" value={unit} onChange={(event) => setUnit(event.target.value)} />

        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={soldByWeight}
            onChange={(event) => setSoldByWeight(event.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-200"
          />
          يباع بالوزن (يقبل كميات كسرية، مثل 1.250 كغم)
        </label>
```

Update the "الكمية" and "حد التنبيه" inputs (currently lines 158-171) to accept fractions when `soldByWeight` is checked:

```typescript
          <Input
            label="الكمية"
            type="number"
            min={0}
            step={soldByWeight ? "0.001" : "1"}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <Input
            label="حد التنبيه"
            type="number"
            min={0}
            step={soldByWeight ? "0.001" : "1"}
            value={minStock}
            onChange={(event) => setMinStock(event.target.value)}
          />
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors, 0 warnings, build succeeds.

Manual smoke-test description (for whoever does the eventual live click-through, not required to close this task): open "إضافة تفصيلية" on `/inventory`, leave barcode empty, check "يباع بالوزن", enter quantity `1.5` — save should succeed (previously this exact combination silently failed twice over: empty barcode blocked, then 1.5 quantity blocked even if barcode had a value).

- [ ] **Step 5: Commit**

```bash
git add components/features/inventory/ProductForm.tsx
git commit -m "$(cat <<'EOF'
إضافة خيار "يباع بالوزن" لنموذج المنتج التفصيلي + إصلاح صمت الباركود الفارغ

يحل ملاحظة تجربة الاستخدام #2 من تقرير الفحص الشامل (رفض صامت بدون رسالة
خطأ) عبر تفعيل الدعم الحقيقي للكميات الكسرية بدل مجرد رسالة خطأ، ويعيد
استخدام نمط "باركود اختياري + توليد تلقائي" الموجود مسبقاً بـ
QuickAddProductForm.tsx بدل اختراع نمط جديد. جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 7: `QuickAddProductForm.tsx` — sold_by_weight checkbox

**Files:**
- Modify: `components/features/inventory/QuickAddProductForm.tsx`

**Interfaces:**
- Consumes: `Product.sold_by_weight` (Task 1).
- Produces: nothing new for later tasks — leaf UI change.

**Note on scope:** the spec named `ProductForm.tsx` explicitly but did not call out this second form. `QuickAddProductForm.tsx` is the primary **mobile** add-product flow (per this project's established mobile-first priority) and has its own independent quantity input with the same whole-number-only `step` gap — without this task, a mobile user could not create a new weighed product from the main "+" flow at all, only from the desktop-only "إضافة تفصيلية" path. Same class of change as Task 6, added here for feature completeness.

No automated test (same reasoning as Task 6).

- [ ] **Step 1: Add `sold_by_weight` state and thread it into the payload**

In `components/features/inventory/QuickAddProductForm.tsx`, add state near the other `useState` calls (after `quantity`, line 37):

```typescript
  const [quantity, setQuantity] = useState("");
  const [soldByWeight, setSoldByWeight] = useState(false);
```

Update the `createProduct` call's payload (currently lines 66-73):

```typescript
        {
          name,
          quantity: Number(quantity) || 0,
          category_id: categoryId || null,
          cost_price: Number(costPrice) || 0,
          sale_price: Number(salePrice) || 0,
          barcode: barcode.trim() || generateBarcode(),
          sold_by_weight: soldByWeight,
        },
```

- [ ] **Step 2: Add the checkbox and make the quantity field fraction-aware**

Add a checkbox right after the quantity `Input` (currently lines 153-162):

```typescript
      <Input
        label="العدد / الكمية"
        type="number"
        inputMode="decimal"
        min={0}
        step={soldByWeight ? "0.001" : "1"}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        className="h-14 text-lg"
        required
      />

      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={soldByWeight}
          onChange={(event) => setSoldByWeight(event.target.checked)}
          className="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-200"
        />
        يباع بالوزن (يقبل كميات كسرية، مثل 1.250 كغم)
      </label>
```

(`inputMode="numeric"` is changed to `inputMode="decimal"` in the same edit above, so mobile keyboards show a decimal point key — `inputMode="numeric"` on some mobile browsers hides it entirely, which would make typing `1.5` impossible on a phone even though the underlying `<input type="number">` itself accepts it.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors, 0 warnings, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/features/inventory/QuickAddProductForm.tsx
git commit -m "$(cat <<'EOF'
إضافة خيار "يباع بالوزن" لنموذج الإضافة السريعة (المسار الجوّال الأساسي)

بدون هذا التعديل، مستخدم الجوال ما يقدر ينشئ منتج وزن جديد من مسار "+"
الأساسي إطلاقاً — فقط من "إضافة تفصيلية" سطح المكتب. جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 8: `ManualProductPicker.tsx` — weight input for weighed products

**Files:**
- Modify: `components/features/pos/ManualProductPicker.tsx`

**Interfaces:**
- Consumes: `ProductWithCategory.sold_by_weight` (Task 1, inherited from `Product`), `roundQuantity` (Task 2), `formatQuantity` (Task 3).
- Produces: nothing new for later tasks — leaf UI change. `onAdd(product, quantity)`'s signature is unchanged (`quantity` can now be fractional, which the caller — `usePOS.ts#addProductToCart`, unchanged by this plan — already accepts as a plain `number`).

No automated test (no component test harness — see Global Constraints).

- [ ] **Step 1: Import the new helpers**

This file already has two separate `@/lib/utils` import lines (`import { cn } from "@/lib/utils";` and `import { formatCurrency } from "@/lib/utils";`). Modify the `formatCurrency` line in place — leave the separate `cn` line untouched:

```typescript
import { formatCurrency, formatQuantity, roundQuantity } from "@/lib/utils";
```

- [ ] **Step 2: Show available stock with `formatQuantity` in the product list**

Replace the product-row stock display (currently line 152):

```typescript
                <span className="shrink-0 text-sm text-gray-500">
                  {formatCurrency(product.sale_price)} · متوفر{" "}
                  {formatQuantity(product.quantity, product.sold_by_weight, product.unit)}
                </span>
```

- [ ] **Step 3: Branch the quantity control on `selectedProduct.sold_by_weight`**

Replace the quantity-stepper block (currently lines 163-181) with a branch: the existing `+`/`-` stepper for count products (byte-for-byte unchanged), a decimal text input for weighed products.

```typescript
          <div className="flex items-center gap-2">
            {selectedProduct.sold_by_weight ? (
              <Input
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0.001"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value) || 0)}
                onBlur={(event) => setQuantity(roundQuantity(Number(event.target.value) || 0))}
                className="h-10 w-24 text-center"
                aria-label="الوزن (كغم)"
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="h-8 w-8 rounded-md bg-white text-lg font-bold hover:bg-gray-100"
                  aria-label="إنقاص الكمية"
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(selectedProduct.quantity, q + 1))}
                  className="h-8 w-8 rounded-md bg-white text-lg font-bold hover:bg-gray-100"
                  aria-label="زيادة الكمية"
                >
                  +
                </button>
              </>
            )}
          </div>
```

- [ ] **Step 4: Cap the confirm action at available stock for weighed products, with an inline error**

`ManualProductPicker` currently has no error-display state (the count-product stepper is already hard-capped via `Math.min`, so it never needed one). Add minimal state and a check, since a typed weight input isn't self-capping the way the stepper is:

Add state near `quantity` (currently line 38):

```typescript
  const [quantity, setQuantity] = useState(1);
  const [weightError, setWeightError] = useState<string | null>(null);
```

Reset it alongside the other reset-on-open/reset-on-select effects (currently lines 40-47 and `selectProduct`, lines 49-53):

```typescript
  useEffect(() => {
    if (!open) return;
    setActiveId(ALL_CATEGORY_ID);
    setSearch("");
    setSelectedProduct(null);
    setQuantity(1);
    setWeightError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function selectProduct(product: ProductWithCategory) {
    if (product.quantity <= 0) return;
    setSelectedProduct(product);
    setQuantity(1);
    setWeightError(null);
  }
```

Update `confirmAdd` (currently lines 55-60) to validate before calling `onAdd`:

```typescript
  function confirmAdd() {
    if (!selectedProduct) return;
    if (selectedProduct.sold_by_weight && (quantity <= 0 || quantity > selectedProduct.quantity)) {
      setWeightError(`الوزن يجب أن يكون بين 0.001 و${formatQuantity(selectedProduct.quantity, true, selectedProduct.unit)}`);
      return;
    }
    onAdd(selectedProduct, quantity);
    setSelectedProduct(null);
    setQuantity(1);
    setWeightError(null);
  }
```

Show the error and disable the button when it's set (update the confirm block, currently lines 160-186):

```typescript
      {selectedProduct ? (
        <div className="flex flex-col gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3">
          <div className="flex items-center gap-3">
            <span className="flex-1 truncate font-medium text-gray-900">{selectedProduct.name}</span>
            {/* ...quantity control from Step 3 goes here, unchanged... */}
            <Button size="sm" onClick={confirmAdd} disabled={selectedProduct.sold_by_weight && quantity <= 0}>
              ➕ إضافة
            </Button>
          </div>
          {weightError ? <p className="text-sm text-red-600">{weightError}</p> : null}
        </div>
      ) : null}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors, 0 warnings, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/features/pos/ManualProductPicker.tsx
git commit -m "$(cat <<'EOF'
دعم إدخال الوزن الكسري بالاختيار اليدوي (ManualProductPicker)

منتجات الوزن تحصل على حقل إدخال رقمي بدل أزرار +/- الصحيحة، مع تحقق من
سقف المخزون عند التأكيد. المنتجات العادية بدون أي تغيير سلوكي. جزء من
خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 9: `CartGrid.tsx` — weight input for weighed cart lines

**Files:**
- Modify: `components/features/pos/CartGrid.tsx`

**Interfaces:**
- Consumes: `CartItem.soldByWeight` (Task 1), `roundQuantity` (Task 2).
- Produces: nothing new for later tasks — leaf UI change. `updateQuantity`'s existing signature (`hooks/usePOS.ts`, unchanged by this plan) already accepts a fractional `number`.

No automated test (no component test harness — see Global Constraints).

- [ ] **Step 1: Import the new helper and `Input` component**

```typescript
"use client";

import { usePOSContext } from "@/context/POSContext";
import { formatCurrency, roundQuantity } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
```

- [ ] **Step 2: Branch the quantity control on `item.soldByWeight`**

Replace the quantity-stepper block (currently lines 33-51) with a branch, mirroring Task 8's structure:

```typescript
            <div className="flex items-center gap-3">
              {item.soldByWeight ? (
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0.001"
                  value={item.quantity}
                  onChange={(event) => updateQuantity(item.barcode, Number(event.target.value) || 0)}
                  onBlur={(event) => updateQuantity(item.barcode, roundQuantity(Number(event.target.value) || 0))}
                  className="h-11 w-24 text-center"
                  aria-label={`وزن ${item.name}`}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.barcode, item.quantity - 1)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-lg font-bold text-gray-700 shadow-sm hover:bg-gray-100"
                    aria-label="إنقاص الكمية"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-base font-semibold">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.barcode, item.quantity + 1)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-lg font-bold text-gray-700 shadow-sm hover:bg-gray-100"
                    aria-label="زيادة الكمية"
                  >
                    +
                  </button>
                </>
              )}
            </div>
```

Note: unlike `ManualProductPicker`, this cart-line input does not hard-cap against `item.availableStock` on every keystroke — `availableStock` here is explicitly documented as advisory/last-known (see `types/pos.ts`'s `CartItem.availableStock` doc comment from this session's earlier stock-decrement-timing change), and the real cap is enforced authoritatively server-side at checkout/hold time (`create_sale_atomic`/`hold_sale`, migrations 42/43) — consistent with how this cart already works for every other quantity edit today.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors, 0 warnings, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/features/pos/CartGrid.tsx
git commit -m "$(cat <<'EOF'
دعم تعديل الوزن الكسري مباشرة بسطر السلة (CartGrid)

أسطر منتجات الوزن تحصل على حقل إدخال رقمي بدل أزرار +/- الصحيحة —
يعالج أيضاً الحالة الافتراضية عند مسح باركود منتج وزن (يُضاف بوزن=1
افتراضي، والكاشير يصححه هنا). جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 10: Inventory display — `formatQuantity` in `StockTable`/`CategoryProductList`

**Files:**
- Modify: `components/features/inventory/StockTable.tsx:54`
- Modify: `components/features/inventory/CategoryProductList.tsx:151-154`

**Interfaces:**
- Consumes: `formatQuantity` (Task 3), `Product.sold_by_weight`/`Product.unit` (Task 1, already-existing column).
- Produces: nothing new for later tasks — leaf display change.

No automated test (no component test harness — see Global Constraints).

- [ ] **Step 1: `StockTable.tsx`**

This file already has a separate `import { formatCurrency } from "@/lib/utils";` line (plus its own separate `import { cn } from "@/lib/utils";` line, both pre-existing — this repo does not merge same-module imports). Modify the `formatCurrency` line in place (do not add a second, conflicting `formatCurrency` import):

```typescript
import { formatCurrency, formatQuantity } from "@/lib/utils";
```

Replace the quantity display (currently line 54):

```typescript
                <span className={cn("font-semibold", isLowStock(product) && "text-red-600")}>
                  {formatQuantity(product.quantity, product.sold_by_weight, product.unit)}
                  {isLowStock(product) ? " ⚠" : ""}
                </span>
```

- [ ] **Step 2: `CategoryProductList.tsx`**

Add the import (check the top of the file for its existing `@/lib/utils` import and merge into it — this file already imports `cn` from `@/lib/utils` per the codebase's convention seen in `StockTable.tsx`):

```typescript
import { cn, formatQuantity } from "@/lib/utils";
```

Replace the quantity display (currently lines 151-154):

```typescript
      <span className={cn("font-semibold", isLowStock(product) && "text-red-600")}>
        {formatQuantity(product.quantity, product.sold_by_weight, product.unit)}
        {isLowStock(product) ? " ⚠" : ""}
      </span>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors, 0 warnings, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/features/inventory/StockTable.tsx components/features/inventory/CategoryProductList.tsx
git commit -m "$(cat <<'EOF'
عرض الكميات الكسرية بشكل نظيف بجدول المخزون وقوائم الأقسام

جزء من خطة تنفيذ
docs/superpowers/specs/2026-09-09-fractional-quantity-support-design.md.
EOF
)"
```

---

### Task 11: Final full verification

**Files:** none (verification-only task).

**Interfaces:** none.

- [ ] **Step 1: Run the full verification suite**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all four green — 0 typecheck errors, 0 lint warnings/errors, every test passing (the full suite, not just the files touched in this plan — confirms nothing in this plan's changes broke an unrelated existing test), build succeeds.

- [ ] **Step 2: Grep for any leftover reference to the old un-rounded arithmetic pattern**

Run: `grep -rn "unitPrice \* item.quantity" hooks/ types/ components/ --include="*.ts" --include="*.tsx"`
Expected: the only remaining raw (non-`roundMoney`-wrapped) occurrence should be `CartGrid.tsx`'s live per-line display total (`formatCurrency(item.unitPrice * item.quantity)`) — this one is deliberately left as-is per the spec ("optional polish, not required for correctness," since `formatCurrency`'s `Intl.NumberFormat` already visually rounds to 2 decimals for display). If any other occurrence turns up, it was missed by Tasks 4/5 and should be fixed before closing this task.

- [ ] **Step 3: No commit needed for this task** (verification-only; if Step 2 found something to fix, fix it and commit that fix using the same message convention as the earlier tasks).
