# Sales Export (Excel) — Design

## Context

Gaps-analysis item #3 (`docs/gaps-analysis.md`): dddmart has no way to export sales or inventory data, and no backup mechanism. For a merchant paying for this as SaaS, being able to download their own data on demand is both a trust requirement and, by the client's own framing, sufficient as their "backup" — a downloadable file *is* the backup for this phase, not a separate mechanism.

This phase covers **sales only**. Inventory/customers/employees export is explicitly out of scope and can follow the same pattern later if requested.

## Access

`/sales` is already gated to `role === "admin"` (`app/(dashboard)/sales/page.tsx`). The export button lives on this page, so no new access control is needed — it inherits the existing admin-only gate.

## UI

A "تصدير Excel" button on `/sales` (page header, near the existing tab bar) opens a `Modal` containing:
- A `RangeDatePicker` (reused as a controlled component, same as the existing "الاتجاه" tab), defaulting to the last 7 days.
- A confirm button that triggers the export.

Range is capped at `MAX_RANGE_DAYS` (90, the same constant already used by `getSalesTrend`) — the date picker or the service call must enforce this; picking a wider range clamps or shows a validation message rather than silently querying an unbounded range.

If the resulting range has zero sales, show a toast ("لا توجد مبيعات في الفترة المحددة") and skip the download — no empty file.

## Data

New function in `services/sales.service.ts`:

```ts
export interface SalesExportRow {
  invoiceNumber: string;
  createdAt: string; // ISO
  cashierName: string; // resolved from profiles.full_name; "غير معروف" if the profile row no longer exists
  paymentMethod: string;
  discountAmount: number;
  totalAmount: number;
  itemCount: number; // sum of sale_items.quantity for that invoice
}

export async function getSalesForExport(
  supabase: Client,
  startDate: Date,
  endDate: Date,
): Promise<SalesExportRow[]>
```

Implementation notes:
- Follows the existing `resolveTrendRange`-style clamping: reject/clamp ranges wider than `MAX_RANGE_DAYS`.
- Fetches `sales` in range (same `gte`/`lte` on `created_at` pattern as `getDailySales`), then:
  - Resolves `cashier_id -> profiles.full_name` in one batched query (`.in("id", cashierIds)`), not one query per sale.
  - Sums `sale_items.quantity` per `sale_id` in one batched query (`.in("sale_id", saleIds)`), not one query per sale.
- Returns rows sorted by `created_at` descending (matches existing invoice-list ordering elsewhere).
- Out of scope for this row shape: returns/damages/reconciliation netting. This is a flat invoice list, not a profit report — that already exists on-screen in `DailyReport`.

## File generation

Client-side, using [`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS) — first spreadsheet dependency in this repo. Dynamically imported (`await import("xlsx")`) inside the modal's confirm handler, so the library is not part of the main bundle for users who never export.

```ts
const XLSX = await import("xlsx");
const worksheet = XLSX.utils.json_to_sheet(rows.map(toSheetRow));
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "المبيعات");
XLSX.writeFile(workbook, `مبيعات_${startDate}_${endDate}.xlsx`);
```

`toSheetRow` maps `SalesExportRow` to Arabic column headers in this order:

| رقم الفاتورة | التاريخ والوقت | الكاشير | طريقة الدفع | عدد القطع | الخصم | الإجمالي |

Rejected alternative: a server-side API route generating the file with `exceljs`. Every other report in this app fetches data directly from the browser Supabase client under RLS (`useDailyReport`, `useSalesAnalytics`, etc.) — a server route would need to either re-derive store scope from cookies or reach for the service-role client (`lib/supabase/admin.ts`), adding a new trust boundary for what is otherwise a plain read-and-format operation. Client-side generation matches the existing architecture and needs no new route.

## Error handling

- Zero-row range: `components/ui/Toast.tsx`, no download (see UI section).
- Fetch error (network/RLS/etc.) or `xlsx` import failure: inline red text inside the modal (the same `{error ? <p className="text-sm text-red-600">{error}</p> : null}` convention already used by `StockReconciliationForm` and other modal forms), not `Toast` — `Toast.tsx` hardcodes a green checkmark icon that would be semantically wrong for an error. `Toast` is reserved for the zero-row case, which is informational rather than an error.

## Testing

- `services/sales.service.export.test.ts` — new test file, using the same hand-rolled Supabase fake already shared by the other `sales.service.*.test.ts` files. Covers: date-range filtering, the `MAX_RANGE_DAYS` cap/clamp, cashier-name resolution (including a missing/deleted profile), and `itemCount` summation across multiple sale_items rows.
- No dedicated component test for the modal/button — matches this repo's existing convention where `RangeDatePicker`/`DailyReport` (and other report-page UI) aren't unit-tested; only service/hook/lib logic gets tests.
- Manual smoke test before merge: export a real range from `/sales`, open the resulting `.xlsx`, confirm Arabic headers render correctly and totals match what's on-screen.

## Out of scope (this phase)

- Inventory/products export.
- Customers/employees export.
- PDF export.
- CSV export.
- A full-store data snapshot ("everything" backup) beyond sales.
- Scheduled/automatic backups.

Any of these can follow the same pattern (new service function + reused `Modal`/`RangeDatePicker` + `xlsx`) in a future phase if requested.
