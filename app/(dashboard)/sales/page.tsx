"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getDailySalesSummary,
  getSalesTrend,
  getTopCategories,
  getTopProducts,
} from "@/services/sales.service";
import type { DailySalesPoint, TopCategoryStat, TopProductStat } from "@/services/sales.service";
import type { Sale } from "@/types/pos";
import { DailyReport } from "@/components/features/sales/DailyReport";
import { SalesTrendChart } from "@/components/features/sales/SalesTrendChart";
import { TopProductsList } from "@/components/features/sales/TopProductsList";
import { TopCategoriesList } from "@/components/features/sales/TopCategoriesList";
import { cn } from "@/lib/utils";

type RangeOption = "7" | "30";

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: "7", label: "آخر 7 أيام" },
  { value: "30", label: "آخر 30 يوماً" },
];

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [range, setRange] = useState<RangeOption>("7");
  const [trend, setTrend] = useState<DailySalesPoint[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductStat[]>([]);
  const [topCategories, setTopCategories] = useState<TopCategoryStat[]>([]);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    void getDailySalesSummary(supabase, new Date()).then((summary) => {
      setSales(summary.sales);
      setTotalRevenue(summary.totalRevenue);
      setTotalProfit(summary.totalProfit);
      setIsLoading(false);
    });
  }, []);

  const loadAnalytics = useCallback(async (days: number) => {
    setIsAnalyticsLoading(true);
    const supabase = createClient();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const [trendData, productsData, categoriesData] = await Promise.all([
      getSalesTrend(supabase, days),
      getTopProducts(supabase, startDate, endDate),
      getTopCategories(supabase, startDate, endDate),
    ]);

    setTrend(trendData);
    setTopProducts(productsData);
    setTopCategories(categoriesData);
    setIsAnalyticsLoading(false);
  }, []);

  useEffect(() => {
    void loadAnalytics(Number(range));
  }, [range, loadAnalytics]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">تقرير مبيعات اليوم</h1>
        {isLoading ? (
          <p className="mt-4 text-gray-400">جارٍ التحميل...</p>
        ) : (
          <div className="mt-4">
            <DailyReport sales={sales} totalRevenue={totalRevenue} totalProfit={totalProfit} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">تحليلات المبيعات</h2>
          <div className="flex gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  range === option.value
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-gray-200 bg-white text-gray-600",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {isAnalyticsLoading ? (
          <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
        ) : (
          <>
            <SalesTrendChart data={trend} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TopProductsList products={topProducts} />
              <TopCategoriesList categories={topCategories} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
