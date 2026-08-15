"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listSuppliers } from "@/services/suppliers.service";
import type { SupplierWithBalance } from "@/types/supplier";

/** Loads the supplier list for the /suppliers screen, optionally filtered by a search term. */
export function useSuppliers(search?: string) {
  const [data, setData] = useState<SupplierWithBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await listSuppliers(supabase, { search });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل قائمة الموردين");
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, isLoading, error, reload };
}
