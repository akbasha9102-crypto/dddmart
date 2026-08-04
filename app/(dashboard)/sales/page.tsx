"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDailySalesSummary } from "@/services/sales.service";
import type { Sale } from "@/types/pos";
import { DailyReport } from "@/components/features/sales/DailyReport";

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    void getDailySalesSummary(supabase, new Date()).then((summary) => {
      setSales(summary.sales);
      setTotalRevenue(summary.totalRevenue);
      setTotalProfit(summary.totalProfit);
      setIsLoading(false);
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-gray-900">تقرير مبيعات اليوم</h1>
      {isLoading ? (
        <p className="text-gray-400">جارٍ التحميل...</p>
      ) : (
        <DailyReport sales={sales} totalRevenue={totalRevenue} totalProfit={totalProfit} />
      )}
    </div>
  );
}
