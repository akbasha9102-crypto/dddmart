"use client";

import { useMemo, useState } from "react";
import type { CategoryRankingStat, ProductRankingStat } from "@/services/sales.service";
import { formatCurrency, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getCategoryIcon } from "@/lib/categoryIcons";

type SortField = "totalRevenue" | "totalQuantity" | "totalProfit";
type SortDirection = "desc" | "asc";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "totalRevenue", label: "الإيراد" },
  { value: "totalQuantity", label: "الكمية" },
  { value: "totalProfit", label: "الربح" },
];

const PAGE_SIZE = 15;

interface RankingListProps {
  title: string;
  items: (ProductRankingStat | CategoryRankingStat)[];
  onCategoryClick?: (categoryId: string | null, categoryName: string) => void;
}

function isCategoryStat(item: ProductRankingStat | CategoryRankingStat): item is CategoryRankingStat {
  return "categoryColor" in item;
}

/**
 * Generic ranked list for both products and categories: sort field + direction
 * toggle, "عرض المزيد" client-side pagination, and revenue share badge. Profit
 * figures come from each sale's snapshotted cost at time of sale (accurate,
 * not estimated from current cost_price).
 */
export function RankingList({ title, items, onCategoryClick }: RankingListProps) {
  const [sortField, setSortField] = useState<SortField>("totalRevenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const diff = a[sortField] - b[sortField];
      return sortDirection === "desc" ? -diff : diff;
    });
    return copy;
  }, [items, sortField, sortDirection]);

  const visible = sorted.slice(0, visibleCount);

  function toggleDirection() {
    setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
  }

  function handleSortFieldChange(field: SortField) {
    setSortField(field);
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-3 p-4 pb-2">
        <div className="flex items-center justify-between">
          {title ? <p className="text-sm font-medium text-gray-700">{title}</p> : <span />}
          <button type="button" onClick={toggleDirection} className="text-xs font-medium text-brand-700">
            {sortDirection === "desc" ? "تنازلي ▼" : "تصاعدي ▲"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSortFieldChange(option.value)}
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
        <>
          <div className="flex flex-col divide-y divide-gray-100 px-4">
            {visible.map((item, index) => {
              const key = isCategoryStat(item) ? (item.categoryId ?? item.categoryName) : (item.productId ?? item.productName);
              const name = isCategoryStat(item) ? item.categoryName : item.productName;
              const clickable = isCategoryStat(item) && onCategoryClick;
              const Icon = isCategoryStat(item) ? getCategoryIcon(item.categoryIcon) : null;

              const content = (
                <>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                    {index + 1}
                  </span>
                  {isCategoryStat(item) && Icon ? (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: item.categoryColor }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  <span className="flex-1 truncate text-right font-medium text-gray-900">{name}</span>
                  <span className="shrink-0 text-xs text-gray-400">{item.revenueSharePercent.toFixed(1)}٪</span>
                </>
              );

              const details = (
                <div className="flex flex-col items-end gap-0.5 text-xs">
                  <span className="font-semibold text-brand-700">{formatCurrency(item.totalRevenue)}</span>
                  <span className="text-gray-500">{item.totalQuantity} قطعة</span>
                  <span className="text-green-700">{formatCurrency(item.totalProfit)} <span className="text-gray-400">(تقديري)</span></span>
                </div>
              );

              return clickable ? (
                <button
                  key={key}
                  type="button"
                  onClick={() => onCategoryClick?.(item.categoryId, item.categoryName)}
                  className="flex items-center gap-3 py-3 text-right"
                >
                  {content}
                  {details}
                </button>
              ) : (
                <div key={key} className="flex items-center gap-3 py-3">
                  {content}
                  {details}
                </div>
              );
            })}
          </div>

          {visibleCount < sorted.length ? (
            <div className="p-4 pt-3">
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                عرض المزيد
              </Button>
            </div>
          ) : (
            <div className="h-4" />
          )}
        </>
      )}
    </Card>
  );
}
