"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDailyReportDetails } from "@/services/sales.service";
import type { DailyReportDetails } from "@/services/sales.service";

/** Loads the rich single-day report for a fixed date (today, for the "اليوم" tab). */
export function useDailyReport(date: Date) {
  const [data, setData] = useState<DailyReportDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dateKey = date.toISOString().slice(0, 10);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await getDailyReportDetails(supabase, new Date(dateKey));
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل تقرير اليوم");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, isLoading, error, reload };
}
