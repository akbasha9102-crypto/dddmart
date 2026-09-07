"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { usePOS, type UsePOSReturn } from "@/hooks/usePOS";
import { useShift } from "@/hooks/useShift";
import { useAuth } from "@/context/AuthContext";

type POSContextValue = UsePOSReturn & {
  shift: ReturnType<typeof useShift>["shift"];
  isShiftLoading: boolean;
  isShiftSubmitting: boolean;
  shiftError: string | null;
  openShift: ReturnType<typeof useShift>["open"];
  closeShift: ReturnType<typeof useShift>["close"];
};

const POSContext = createContext<POSContextValue | null>(null);

export function POSProvider({ children }: { children: ReactNode }) {
  const { user, storeId } = useAuth();
  const {
    shift,
    isLoading: isShiftLoading,
    isSubmitting: isShiftSubmitting,
    error: shiftError,
    open: openShift,
    close: closeShift,
  } = useShift({ cashierId: user?.id ?? null, storeId });
  const pos = usePOS({ cashierId: user?.id ?? null, storeId, shift });

  return (
    <POSContext.Provider
      value={{ ...pos, shift, isShiftLoading, isShiftSubmitting, shiftError, openShift, closeShift }}
    >
      {children}
    </POSContext.Provider>
  );
}

export function usePOSContext() {
  const context = useContext(POSContext);
  if (!context) {
    throw new Error("usePOSContext must be used within a POSProvider");
  }
  return context;
}
