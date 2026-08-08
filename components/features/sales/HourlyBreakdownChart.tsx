"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HourlyBucket } from "@/services/sales.service";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface HourlyBreakdownChartProps {
  data: HourlyBucket[];
}

/** Small 24-column bar chart of revenue by hour of day. Fixed height, no horizontal scroll on mobile. */
export function HourlyBreakdownChart({ data }: HourlyBreakdownChartProps) {
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-gray-700">توزيع المبيعات حسب الساعة</p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="hour" tickFormatter={(value: number) => `${value}`} fontSize={10} interval={2} />
            <YAxis tickFormatter={(value: number) => formatCurrency(value)} fontSize={10} width={70} />
            <Tooltip
              formatter={(value) => formatCurrency(Number(value))}
              labelFormatter={(label) => `الساعة ${label}:00`}
            />
            <Bar dataKey="revenue" fill="#cc785c" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
