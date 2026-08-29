"use client";

import type { PeriodComparison } from "@/services/sales.service";
import { formatCurrency, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { CalendarDays } from "lucide-react";

interface DailyComparisonCardsProps {
  comparisonWithYesterday: PeriodComparison;
  comparisonWithLastWeekSameDay: PeriodComparison;
}

function ComparisonCard({ title, comparison }: { title: string; comparison: PeriodComparison }) {
  const percent = comparison.revenueChangePercent;
  const isUp = percent !== null && percent >= 0;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          <CalendarDays className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm text-gray-500">{title}</p>
      </div>
      <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(comparison.currentRevenue)}</p>
      <p className="mt-1 text-xs text-gray-400">مقابل {formatCurrency(comparison.previousRevenue)}</p>
      {percent === null ? (
        <p className="mt-2 text-sm text-gray-400">لا توجد بيانات مقارنة</p>
      ) : (
        <p className={cn("mt-2 text-sm font-semibold", isUp ? "text-green-700" : "text-red-600")}>
          {isUp ? "▲" : "▼"} {Math.abs(percent).toFixed(1)}٪
        </p>
      )}
    </Card>
  );
}

/** Two side-by-side comparison cards (revenue vs. yesterday / same weekday last week) with color-coded percent change. */
export function DailyComparisonCards({ comparisonWithYesterday, comparisonWithLastWeekSameDay }: DailyComparisonCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ComparisonCard title="مقارنة بالأمس" comparison={comparisonWithYesterday} />
      <ComparisonCard title="مقارنة بنفس اليوم الأسبوع الماضي" comparison={comparisonWithLastWeekSameDay} />
    </div>
  );
}
