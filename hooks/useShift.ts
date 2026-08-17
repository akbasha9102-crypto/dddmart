"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { closeShift, getOpenShift, openShift } from "@/services/shifts.service";
import type { Shift } from "@/types/shifts";

interface UseShiftOptions {
  cashierId: string | null;
  storeId: string | null;
}

/** Loads the cashier's currently open shift (if any) and exposes open/close actions. Mirrors the shape of usePOS's isCheckingOut/checkout pairing. */
export function useShift({ cashierId, storeId }: UseShiftOptions) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cashierId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    const supabase = createClient();

    getOpenShift(supabase, cashierId)
      .then((row) => {
        if (!cancelled) setShift(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "تعذر تحميل الوردية");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cashierId]);

  const open = useCallback(
    async (openingBalance: number) => {
      if (!cashierId || !storeId) return;
      setError(null);
      setIsSubmitting(true);
      try {
        const supabase = createClient();
        const row = await openShift(supabase, { openingBalance }, cashierId, storeId);
        setShift(row);
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر فتح الوردية");
      } finally {
        setIsSubmitting(false);
      }
    },
    [cashierId, storeId],
  );

  const close = useCallback(
    async (countedAmount: number) => {
      if (!shift || !storeId) return false;
      setError(null);
      setIsSubmitting(true);
      try {
        const supabase = createClient();
        await closeShift(supabase, { shiftId: shift.id, countedAmount }, cashierId, storeId, false);
        setShift(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر إغلاق الوردية");
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [shift, storeId, cashierId],
  );

  return { shift, isLoading, isSubmitting, error, open, close };
}
