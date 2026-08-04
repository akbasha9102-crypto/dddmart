"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { usePOS, type UsePOSReturn } from "@/hooks/usePOS";
import { useAuth } from "@/context/AuthContext";

const POSContext = createContext<UsePOSReturn | null>(null);

export function POSProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pos = usePOS({ cashierId: user?.id ?? null });

  return <POSContext.Provider value={pos}>{children}</POSContext.Provider>;
}

export function usePOSContext() {
  const context = useContext(POSContext);
  if (!context) {
    throw new Error("usePOSContext must be used within a POSProvider");
  }
  return context;
}
