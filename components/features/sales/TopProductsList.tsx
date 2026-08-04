"use client";

import type { TopProductStat } from "@/services/sales.service";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface TopProductsListProps {
  products: TopProductStat[];
}

/** Ranked list (not a chart — long Arabic product names don't fit bar charts well). */
export function TopProductsList({ products }: TopProductsListProps) {
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-gray-700">الأكثر مبيعاً</p>
      {products.length === 0 ? (
        <p className="p-4 text-center text-gray-400">لا توجد بيانات</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100">
          {products.map((product, index) => (
            <div key={product.productId ?? product.productName} className="flex items-center gap-3 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                {index + 1}
              </span>
              <span className="flex-1 truncate font-medium text-gray-900">{product.productName}</span>
              <span className="text-sm text-gray-500">{product.totalQuantity} قطعة</span>
              <span className="font-semibold text-brand-700">{formatCurrency(product.totalRevenue)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
