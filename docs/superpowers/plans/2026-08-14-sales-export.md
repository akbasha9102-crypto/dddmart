# Sales Export (Excel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin download a date-range of sales invoices as an `.xlsx` file from `/sales`, serving as both a data-export and a "backup" feature for the merchant.

**Architecture:** One new service function (`getSalesForExport` in `services/sales.service.ts`) fetches and shapes the data under RLS, exactly like every other report function in this file. One new client component (`SalesExportModal`) reuses the existing `RangeDatePicker`/`Modal`/`Toast`/`Button` UI primitives, and generates the `.xlsx` entirely in the browser via a dynamically-imported `xlsx` library — no new API route.

**Tech Stack:** Next.js 15 App Router (client components), Supabase (`@supabase/supabase-js` browser client under RLS), Vitest, `xlsx` (SheetJS, new dependency).

**Spec:** `docs/superpowers/specs/2026-08-14-sales-export-design.md`

## Global Constraints

- Sales export only — no inventory/customers/employees, no PDF/CSV, no full-store backup, no scheduled backups (all explicitly out of scope per spec).
- Date range capped at `MAX_RANGE_DAYS` (90), enforced via the existing `assertRangeWithinLimit` helper in `services/sales.service.ts` — do not duplicate this logic.
- `/sales` is already gated to `role === "admin"` in `app/(dashboard)/sales/page.tsx` — no new access control needed.
- Cashier name resolves via `profiles.full_name`; both a null `cashier_id` and a missing/deleted profile row fall back to the exact string `"غير معروف"`.
- File generation is client-side only (`xlsx` dynamically imported inside the export handler, not statically at module scope) — this keeps the ~600KB library out of the main bundle for users who never export.

---

### Task 1: `getSalesForExport` service function

**Files:**
- Modify: `services/sales.service.ts` (add near the other range-based report functions, e.g. after `getProductRanking`)
- Test: `services/sales.service.export.test.ts` (new file)

**Interfaces:**
- Consumes: `Client` type alias (`SupabaseClient<Database>`, already defined at the top of `services/sales.service.ts`), `assertRangeWithinLimit(startDate: Date, endDate: Date): void` (already defined, throws `` `المدى الزمني الأقصى المسموح به هو ${MAX_RANGE_DAYS} يوماً` `` when the span is too wide), `Sale` type from `@/types/pos`.
- Produces: `export interface SalesExportRow { invoiceNumber: string; createdAt: string; cashierName: string; paymentMethod: PaymentMethod; discountAmount: number; totalAmount: number; itemCount: number; }` and `export async function getSalesForExport(supabase: Client, startDate: Date, endDate: Date): Promise<SalesExportRow[]>` — Task 2's `SalesExportModal` imports both from `@/services/sales.service`. `PaymentMethod` is `"cash" | "credit"`, importable from `@/types/database.types`.

- [ ] **Step 1: Write the failing test**

Create `services/sales.service.export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSalesForExport } from "./sales.service";
import type { Database } from "@/types/database.types";
import type { Sale } from "@/types/pos";

interface ProfileFixture {
  id: string;
  full_name: string;
}

interface SaleItemFixture {
  sale_id: string;
  quantity: number;
}

/**
 * Hand-rolled fake covering exactly the chains getSalesForExport exercises:
 * sales.select().gte().lte().order(), profiles.select().in(), and
 * sale_items.select().in(). Matches the style of sales.service.reconciliation.test.ts.
 */
function createFakeSupabase(fixtures: {
  sales: Sale[];
  profiles: ProfileFixture[];
  saleItems: SaleItemFixture[];
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
      if (table === "profiles") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "id") {
                const rows = fixtures.profiles.filter((profile) => values.includes(profile.id));
                return { data: rows, error: null };
              }
              throw new Error(`unexpected profiles.in column ${column}`);
            },
          }),
        };
      }
      if (table === "sale_items") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "sale_id") {
                const rows = fixtures.saleItems.filter((item) => values.includes(item.sale_id));
                return { data: rows, error: null };
              }
              throw new Error(`unexpected sale_items.in column ${column}`);
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

function buildSale(overrides: Partial<Sale> = {}): Sale {
  return {
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
    ...overrides,
  };
}

describe("getSalesForExport", () => {
  it("returns invoice rows with resolved cashier name and summed item count", async () => {
    const supabase = createFakeSupabase({
      sales: [buildSale({ cashier_id: "cashier-1" })],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
      saleItems: [
        { sale_id: "sale-1", quantity: 3 },
        { sale_id: "sale-1", quantity: 2 },
      ],
    });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceNumber: "INV-1",
      cashierName: "أحمد",
      itemCount: 5,
      totalAmount: 100,
      discountAmount: 0,
      paymentMethod: "cash",
    });
  });

  it("falls back to 'غير معروف' when cashier_id is null", async () => {
    const supabase = createFakeSupabase({
      sales: [buildSale({ cashier_id: null })],
      profiles: [],
      saleItems: [],
    });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows[0].cashierName).toBe("غير معروف");
    expect(rows[0].itemCount).toBe(0);
  });

  it("falls back to 'غير معروف' when the profile row no longer exists", async () => {
    const supabase = createFakeSupabase({
      sales: [buildSale({ cashier_id: "deleted-cashier" })],
      profiles: [],
      saleItems: [],
    });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows[0].cashierName).toBe("غير معروف");
  });

  it("returns an empty array without querying profiles/sale_items when there are no sales in range", async () => {
    const supabase = createFakeSupabase({ sales: [], profiles: [], saleItems: [] });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows).toEqual([]);
  });

  it("throws an Arabic error when the range exceeds MAX_RANGE_DAYS", async () => {
    const supabase = createFakeSupabase({ sales: [], profiles: [], saleItems: [] });

    await expect(
      getSalesForExport(supabase, new Date("2026-01-01"), new Date("2026-08-01")),
    ).rejects.toThrow("المدى الزمني الأقصى المسموح به هو 90 يوماً");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/sales.service.export.test.ts`
Expected: FAIL — `getSalesForExport` is not exported from `./sales.service`.

- [ ] **Step 3: Write the minimal implementation**

In `services/sales.service.ts`, add after `getProductRanking` (which ends around line 920 — find the blank line before `export async function getCategoryRanking`):

```ts
export interface SalesExportRow {
  invoiceNumber: string;
  createdAt: string;
  cashierName: string;
  paymentMethod: PaymentMethod;
  discountAmount: number;
  totalAmount: number;
  itemCount: number;
}

/**
 * Flat invoice-level list for the Excel export — deliberately not netted
 * against returns/damage/reconciliation (that's DailyReport's job). Batches
 * the cashier-name and item-count lookups (one query each, not one per
 * sale) the same way getProductRanking batches its product lookup.
 */
export async function getSalesForExport(supabase: Client, startDate: Date, endDate: Date): Promise<SalesExportRow[]> {
  assertRangeWithinLimit(startDate, endDate);

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("*")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString())
    .order("created_at", { ascending: false });
  if (salesError) throw salesError;
  if (!sales || sales.length === 0) return [];

  const cashierIds = Array.from(
    new Set(sales.map((sale) => sale.cashier_id).filter((id): id is string => id !== null)),
  );
  const cashierNameById = new Map<string, string>();
  if (cashierIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", cashierIds);
    if (profilesError) throw profilesError;
    (profiles ?? []).forEach((profile) => cashierNameById.set(profile.id, profile.full_name));
  }

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("sale_id, quantity")
    .in(
      "sale_id",
      sales.map((sale) => sale.id),
    );
  if (itemsError) throw itemsError;

  const itemCountBySaleId = new Map<string, number>();
  (items ?? []).forEach((item) => {
    itemCountBySaleId.set(item.sale_id, (itemCountBySaleId.get(item.sale_id) ?? 0) + item.quantity);
  });

  return sales.map((sale) => ({
    invoiceNumber: sale.invoice_number,
    createdAt: sale.created_at,
    cashierName: sale.cashier_id ? (cashierNameById.get(sale.cashier_id) ?? "غير معروف") : "غير معروف",
    paymentMethod: sale.payment_method,
    discountAmount: sale.discount_amount,
    totalAmount: sale.total_amount,
    itemCount: itemCountBySaleId.get(sale.id) ?? 0,
  }));
}
```

Add `PaymentMethod` to the existing type-only import line at the top of the file (currently `import type { Database } from "@/types/database.types";`) — change to:

```ts
import type { Database, PaymentMethod } from "@/types/database.types";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/sales.service.export.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run the full verification suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all clean, all existing + new tests pass (no regressions in the other `sales.service.*.test.ts` files).

- [ ] **Step 6: Commit**

```bash
git add services/sales.service.ts services/sales.service.export.test.ts
git commit -m "Add getSalesForExport for the sales Excel export feature"
```

---

### Task 2: `SalesExportModal` component + wire into `/sales`

**Files:**
- Modify: `package.json` (add `xlsx` dependency)
- Create: `components/features/sales/SalesExportModal.tsx`
- Modify: `app/(dashboard)/sales/page.tsx`

**Interfaces:**
- Consumes: `getSalesForExport(supabase: Client, startDate: Date, endDate: Date): Promise<SalesExportRow[]>` and `SalesExportRow` from `@/services/sales.service` (Task 1); `createClient()` from `@/lib/supabase/client`; `RangeDatePicker`, `CustomRange`, `PresetDays` from `@/components/features/sales/RangeDatePicker`; `Modal` from `@/components/ui/Modal`; `Button` from `@/components/ui/Button`; `Toast` from `@/components/ui/Toast`; `formatDateTime` from `@/lib/utils`.
- Produces: `export function SalesExportModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element` — consumed by `app/(dashboard)/sales/page.tsx`.

- [ ] **Step 1: Install the `xlsx` dependency**

Run: `npm install xlsx`
Expected: `xlsx` appears under `"dependencies"` in `package.json`, and `package-lock.json` updates.

- [ ] **Step 2: Create `components/features/sales/SalesExportModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSalesForExport } from "@/services/sales.service";
import type { SalesExportRow } from "@/services/sales.service";
import { formatDateTime } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { RangeDatePicker } from "@/components/features/sales/RangeDatePicker";
import type { CustomRange, PresetDays } from "@/components/features/sales/RangeDatePicker";

interface SalesExportModalProps {
  open: boolean;
  onClose: () => void;
}

const PAYMENT_METHOD_LABELS: Record<"cash" | "credit", string> = {
  cash: "نقدي",
  credit: "آجل",
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeForPreset(days: PresetDays): CustomRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

function toSheetRow(row: SalesExportRow) {
  return {
    "رقم الفاتورة": row.invoiceNumber,
    "التاريخ والوقت": formatDateTime(row.createdAt),
    "الكاشير": row.cashierName,
    "طريقة الدفع": PAYMENT_METHOD_LABELS[row.paymentMethod],
    "عدد القطع": row.itemCount,
    "الخصم": row.discountAmount,
    "الإجمالي": row.totalAmount,
  };
}

/** Admin-only export of a date range's invoices to a downloadable .xlsx file — see docs/superpowers/specs/2026-08-14-sales-export-design.md. */
export function SalesExportModal({ open, onClose }: SalesExportModalProps) {
  const [preset, setPreset] = useState<PresetDays | null>(7);
  const [customRange, setCustomRange] = useState<CustomRange>(rangeForPreset(7));
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function handlePresetChange(days: PresetDays) {
    setPreset(days);
    setCustomRange(rangeForPreset(days));
  }

  function handleCustomRangeChange(range: CustomRange) {
    setPreset(null);
    setCustomRange(range);
  }

  async function handleExport() {
    if (!customRange.startDate || !customRange.endDate) {
      setError("الرجاء اختيار تاريخ البداية والنهاية");
      return;
    }

    setError(null);
    setIsExporting(true);
    try {
      const supabase = createClient();
      const startDate = new Date(customRange.startDate);
      const endDate = new Date(customRange.endDate);
      const rows = await getSalesForExport(supabase, startDate, endDate);

      if (rows.length === 0) {
        setToastMessage("لا توجد مبيعات في الفترة المحددة");
        return;
      }

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(rows.map(toSheetRow));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "المبيعات");
      XLSX.writeFile(workbook, `مبيعات_${customRange.startDate}_${customRange.endDate}.xlsx`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تصدير الملف");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="تصدير المبيعات">
        <div className="flex flex-col gap-4">
          <RangeDatePicker
            preset={preset}
            customRange={customRange}
            onPresetChange={handlePresetChange}
            onCustomRangeChange={handleCustomRangeChange}
          />

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="button" onClick={handleExport} disabled={isExporting}>
              {isExporting ? "جارٍ التصدير..." : "تصدير Excel"}
            </Button>
          </div>
        </div>
      </Modal>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </>
  );
}
```

- [ ] **Step 3: Wire the button and modal into `app/(dashboard)/sales/page.tsx`**

Add these imports (alongside the existing `Modal`/`Tabs` imports near the top of the file):

```ts
import { Button } from "@/components/ui/Button";
import { SalesExportModal } from "@/components/features/sales/SalesExportModal";
```

Add new state near the other `useState` calls inside `SalesPage`:

```ts
const [isExportModalOpen, setIsExportModalOpen] = useState(false);
```

Replace the header block:

```tsx
      <div>
        <BackToSettingsLink />
        <h1 className="text-xl font-bold text-gray-900">تحليلات المبيعات</h1>
        <Tabs options={PAGE_TABS} value={activeTab} onChange={handleTabChange} className="mt-4" />
      </div>
```

with:

```tsx
      <div>
        <BackToSettingsLink />
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-gray-900">تحليلات المبيعات</h1>
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsExportModalOpen(true)}>
            تصدير Excel
          </Button>
        </div>
        <Tabs options={PAGE_TABS} value={activeTab} onChange={handleTabChange} className="mt-4" />
      </div>
```

Add the modal at the end of the returned JSX, right after the existing category-drilldown `<Modal>` block (before the final closing `</div>`):

```tsx
      <SalesExportModal open={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} />
```

- [ ] **Step 4: Run the full verification suite**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: all clean, all tests still pass, production build succeeds (including the new `xlsx` chunk).

- [ ] **Step 5: Manual smoke test**

Start the dev server (`npm run dev`), log in as an admin, go to `/sales`, click "تصدير Excel", pick a range with known sales, confirm, and open the downloaded `.xlsx`: verify Arabic column headers render correctly (right-to-left), row count matches the on-screen invoice count for that range, and totals match. Also test the empty-range case (pick a range with no sales) and confirm the toast appears with no file download.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/features/sales/SalesExportModal.tsx "app/(dashboard)/sales/page.tsx"
git commit -m "Add sales Excel export modal to /sales"
```
