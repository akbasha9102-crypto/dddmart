"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listCustomers } from "@/services/customers.service";
import type { CustomerWithBalance } from "@/types/customer";

/** Loads the customer list for the /customers screen, optionally filtered by a search term. */
export function useCustomers(search?: string) {
  const [data, setData] = useState<CustomerWithBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await listCustomers(supabase, { search });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل قائمة الزبائن");
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, isLoading, error, reload };
}
