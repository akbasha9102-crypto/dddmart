"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCategoryRanking, getProductRanking, getSalesTrend } from "@/services/sales.service";
import type { CategoryRankingStat, DailySalesPoint, ProductRankingStat } from "@/services/sales.service";
import type { PresetDays, CustomRange } from "@/components/features/sales/RangeDatePicker";

export type AnalyticsRange = { kind: "preset"; days: PresetDays } | { kind: "custom"; startDate: Date; endDate: Date };

function resolveRange(range: AnalyticsRange): { startDate: Date; endDate: Date } {
  if (range.kind === "custom") return { startDate: range.startDate, endDate: range.endDate };

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (range.days - 1));
  startDate.setHours(0, 0, 0, 0);
  return { startDate, endDate };
}

/**
 * Loads trend + product/category ranking together for a shared date range,
 * used by the "الاتجاه" and "الترتيب" tabs. Fetches lazily — call
 * `ensureLoaded` when a tab is first visited instead of on mount.
 */
export function useSalesAnalytics() {
  const [range, setRange] = useState<AnalyticsRange>({ kind: "preset", days: 7 });
  const [trend, setTrend] = useState<DailySalesPoint[]>([]);
  const [productRanking, setProductRanking] = useState<ProductRankingStat[]>([]);
  const [categoryRanking, setCategoryRanking] = useState<CategoryRankingStat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { startDate, endDate } = resolveRange(range);
      const supabase = createClient();
      const [trendData, productData, categoryData] = await Promise.all([
        getSalesTrend(supabase, { startDate, endDate }),
        getProductRanking(supabase, startDate, endDate),
        getCategoryRanking(supabase, startDate, endDate),
      ]);
      setTrend(trendData);
      setProductRanking(productData);
      setCategoryRanking(categoryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل التحليلات");
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (hasLoadedOnce) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  /** Triggers the first fetch. Safe to call repeatedly — only fetches once until `range` changes again. */
  const ensureLoaded = useCallback(() => {
    if (!hasLoadedOnce && !isLoading) void load();
  }, [hasLoadedOnce, isLoading, load]);

  return {
    trend,
    productRanking,
    categoryRanking,
    isLoading,
    error,
    range,
    setRange,
    ensureLoaded,
    reload: load,
  };
}
