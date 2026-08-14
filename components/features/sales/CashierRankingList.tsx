"use client";

import { useMemo, useState } from "react";
import type { CashierRankingStat } from "@/services/sales.service";
import { formatCurrency, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

type SortField = "totalRevenue" | "totalProfit" | "soldReturnsValue";
type SortDirection = "desc" | "asc";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "totalRevenue", label: "الإيراد" },
  { value: "totalProfit", label: "الربح" },
  { value: "soldReturnsValue", label: "مرتجعات مبيعاته" },
];

interface CashierRankingListProps {
  items: CashierRankingStat[];
}

/**
 * Per-cashier ranking with sales totals plus two returns fraud-signal metrics
 * (returns on items the cashier sold, and returns the cashier processed),
 * shown side-by-side so an owner can spot a cashier whose returns are high
 * relative to their revenue. Separate from the generic RankingList by design.
 */
export function CashierRankingList({ items }: CashierRankingListProps) {
  const [sortField, setSortField] = useState<SortField>("totalRevenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const diff = a[sortField] - b[sortField];
      return sortDirection === "desc" ? -diff : diff;
    });
    return copy;
  }, [items, sortField, sortDirection]);

  function toggleDirection() {
    setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-3 p-4 pb-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">ترتيب الكاشير</p>
          <button type="button" onClick={toggleDirection} className="text-xs font-medium text-brand-700">
            {sortDirection === "desc" ? "تنازلي ▼" : "تصاعدي ▲"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSortField(option.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                sortField === option.value
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-gray-200 bg-white text-gray-600",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="p-6 text-center text-gray-400">لا توجد بيانات</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 px-4 pb-4">
          {sorted.map((item, index) => (
            <div key={item.cashierId ?? item.cashierName} className="flex flex-col gap-2 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                  {index + 1}
                </span>
                <span className="flex-1 truncate text-right font-medium text-gray-900">{item.cashierName}</span>
                <div className="flex flex-col items-end gap-0.5 text-xs">
                  <span className="font-semibold text-brand-700">{formatCurrency(item.totalRevenue)}</span>
                  <span className="text-gray-500">{item.totalQuantity} قطعة</span>
                  <span className="text-green-700">{formatCurrency(item.totalProfit)} <span className="text-gray-400">(تقديري)</span></span>
                </div>
              </div>
              <div className="flex gap-2 pr-9">
                <div className="flex flex-1 flex-col rounded-lg bg-amber-50 px-3 py-2 text-xs">
                  <span className="text-amber-700">مرتجعات مبيعاته</span>
                  <span className="font-semibold text-amber-800">{formatCurrency(item.soldReturnsValue)}</span>
                  <span className="text-amber-600">{item.soldReturnsCount} عملية</span>
                </div>
                <div className="flex flex-1 flex-col rounded-lg bg-orange-50 px-3 py-2 text-xs">
                  <span className="text-orange-700">مرتجعات نفّذها</span>
                  <span className="font-semibold text-orange-800">{formatCurrency(item.processedReturnsValue)}</span>
                  <span className="text-orange-600">{item.processedReturnsCount} عملية</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
