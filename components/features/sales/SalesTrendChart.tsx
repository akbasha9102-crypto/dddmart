"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailySalesPoint } from "@/services/sales.service";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface SalesTrendChartProps {
  data: DailySalesPoint[];
}

type Metric = "totalRevenue" | "totalProfit" | "salesCount";

const METRICS: { value: Metric; label: string; color: string; isCurrency: boolean }[] = [
  { value: "totalRevenue", label: "الإيراد", color: "#129055", isCurrency: true },
  { value: "totalProfit", label: "الربح التقديري", color: "#0e7490", isCurrency: true },
  { value: "salesCount", label: "عدد الفواتير", color: "#7c3aed", isCurrency: false },
];

/** Daily trend chart with a metric toggle (revenue/profit/invoice count), switched client-side with no extra network request. */
export function SalesTrendChart({ data }: SalesTrendChartProps) {
  const [metric, setMetric] = useState<Metric>("totalRevenue");
  const active = METRICS.find((item) => item.value === metric) ?? METRICS[0]!;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700">اتجاه المبيعات</p>
        <div className="flex flex-wrap gap-1.5">
          {METRICS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setMetric(item.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                metric === item.value ? "border-brand-600 bg-brand-600 text-white" : "border-gray-200 bg-white text-gray-600",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {metric === "totalProfit" ? <p className="mb-2 text-[11px] text-gray-400">الأرباح تقديرية</p> : null}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value: string) => formatDate(value)} fontSize={12} />
            <YAxis
              tickFormatter={(value: number) => (active.isCurrency ? formatCurrency(value) : String(value))}
              fontSize={12}
              width={80}
            />
            <Tooltip
              formatter={(value) => (active.isCurrency ? formatCurrency(Number(value)) : String(value))}
              labelFormatter={(label) => formatDate(String(label))}
            />
            <Bar dataKey={metric} fill={active.color} radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
