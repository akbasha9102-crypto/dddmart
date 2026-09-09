"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { syncOutbox } from "@/lib/offline/syncManager";
import { getHeldSalesOutbox, getOutbox } from "@/lib/offline/db";
import { resetStaleSyncingHeldSales, resetStaleSyncingSales } from "@/lib/offline/outbox";
import { refreshProductCache } from "@/lib/offline/productCache";

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  conflictCount: number;
  partialCount: number;
  pendingHeldCount: number;
  syncNow: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

/** Mirrors POSContext/AuthContext's pattern: distributes offline/outbox state without prop drilling. Mounted between AuthProvider and POSProvider in app/(dashboard)/layout.tsx since usePOS needs isOnline. */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [partialCount, setPartialCount] = useState(0);
  const [pendingHeldCount, setPendingHeldCount] = useState(0);

  const refreshCounts = useCallback(async () => {
    const outbox = await getOutbox();
    setPendingCount(outbox.filter((sale) => sale.status === "pending" || sale.status === "syncing").length);
    setConflictCount(outbox.filter((sale) => sale.status === "conflict").length);
    setPartialCount(outbox.filter((sale) => sale.status === "partial").length);
    const heldOutbox = await getHeldSalesOutbox();
    setPendingHeldCount(heldOutbox.filter((sale) => sale.status === "pending" || sale.status === "syncing").length);
  }, []);

  const syncNow = useCallback(async () => {
    const supabase = createClient();
    await syncOutbox(supabase);
    await refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    void (async () => {
      // Recover any entry a crashed/closed previous session left stuck on
      // "syncing" (no other code path resets it — see audit item #8).
      await resetStaleSyncingSales();
      await resetStaleSyncingHeldSales();
      await refreshCounts();
    })();
  }, [refreshCounts]);

  useEffect(() => {
    if (!isOnline) return;
    const supabase = createClient();
    void refreshProductCache(supabase);
    void syncNow();
  }, [isOnline, syncNow]);

  return (
    <OfflineContext.Provider value={{ isOnline, pendingCount, conflictCount, partialCount, pendingHeldCount, syncNow }}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOfflineContext(): OfflineContextValue {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error("useOfflineContext must be used within an OfflineProvider");
  }
  return context;
}
