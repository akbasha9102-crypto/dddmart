"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailySalesPoint } from "@/services/sales.service";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface SalesTrendChartProps {
  data: DailySalesPoint[];
}

/** Bar chart of daily revenue over the selected range. Fixed height so it reflows on mobile without horizontal scroll. */
export function SalesTrendChart({ data }: SalesTrendChartProps) {
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-gray-700">اتجاه المبيعات</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value: string) => formatDate(value)} fontSize={12} />
            <YAxis tickFormatter={(value: number) => formatCurrency(value)} fontSize={12} width={80} />
            <Tooltip
              formatter={(value) => formatCurrency(Number(value))}
              labelFormatter={(label) => formatDate(String(label))}
            />
            <Bar dataKey="totalRevenue" fill="#129055" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
