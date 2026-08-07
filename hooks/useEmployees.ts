"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listEmployees } from "@/services/employees.service";
import type { Employee } from "@/services/employees.service";

/** Loads the employee list for the /employees screen (admin only — gated at the page level). */
export function useEmployees() {
  const [data, setData] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await listEmployees(supabase);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل قائمة الموظفين");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, isLoading, error, reload };
}
