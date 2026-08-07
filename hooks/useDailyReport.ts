"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDailyReportDetails } from "@/services/sales.service";
import type { DailyReportDetails } from "@/services/sales.service";

/** Loads the rich single-day report for a fixed date (today, for the "اليوم" tab). Pass `enabled: false` to skip fetching (e.g. while the caller doesn't yet know if the user is authorized to see it). */
export function useDailyReport(date: Date, enabled = true) {
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
    if (!enabled) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, enabled]);

  return { data, isLoading, error, reload };
}
