"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { getStore } from "@/services/stores.service";
import type { Store } from "@/services/stores.service";

/** Loads the current store's name/phone/address — used by /settings/store (edit form) and the receipt/statement printers (display). Always fetches fresh (no caching in AuthContext) so an edit is reflected on the very next print without a full page reload. */
export function useStoreProfile() {
  const { storeId } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!storeId) {
      setStore(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const supabase = createClient();
      const result = await getStore(supabase, storeId);
      setStore(result);
    } finally {
      setIsLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { store, isLoading, refetch };
}
