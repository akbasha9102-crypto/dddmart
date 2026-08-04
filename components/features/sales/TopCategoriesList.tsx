"use client";

import type { TopCategoryStat } from "@/services/sales.service";
import { formatCurrency } from "@/lib/utils";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { Card } from "@/components/ui/Card";

interface TopCategoriesListProps {
  categories: TopCategoryStat[];
}

/** Ranked list of categories by revenue, with color swatch + icon per row. */
export function TopCategoriesList({ categories }: TopCategoriesListProps) {
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-gray-700">الأقسام الأكثر مبيعاً</p>
      {categories.length === 0 ? (
        <p className="p-4 text-center text-gray-400">لا توجد بيانات</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100">
          {categories.map((category, index) => {
            const Icon = getCategoryIcon(category.categoryIcon);
            return (
              <div key={category.categoryId ?? category.categoryName} className="flex items-center gap-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                  {index + 1}
                </span>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: category.categoryColor }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 truncate font-medium text-gray-900">{category.categoryName}</span>
                <span className="text-sm text-gray-500">{category.totalQuantity} قطعة</span>
                <span className="font-semibold text-brand-700">{formatCurrency(category.totalRevenue)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
