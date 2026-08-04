"use client";

import { cn, formatCurrency } from "@/lib/utils";

interface ProfitPreviewProps {
  costPrice: string;
  salePrice: string;
  className?: string;
}

export function ProfitPreview({ costPrice, salePrice, className }: ProfitPreviewProps) {
  const cost = Number(costPrice) || 0;
  const sale = Number(salePrice) || 0;

  if (cost <= 0 && sale <= 0) {
    return <p className={cn("text-xs text-gray-400", className)}>أدخل السعرين لعرض هامش الربح</p>;
  }

  const profit = sale - cost;

  if (sale <= cost) {
    return (
      <p
        className={cn(
          "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800",
          className,
        )}
      >
        ⚠ سعر البيع أقل من أو يساوي سعر الشراء — ستبيع بخسارة أو بدون ربح
      </p>
    );
  }

  const marginPct = cost > 0 ? (profit / sale) * 100 : null;

  return (
    <p className={cn("rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700", className)}>
      الربح لكل قطعة: {formatCurrency(profit)}
      {marginPct !== null ? ` (${marginPct.toFixed(0)}% هامش ربح)` : ""}
    </p>
  );
}
