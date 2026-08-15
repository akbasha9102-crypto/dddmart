"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getShiftsForReport, closeShift } from "@/services/shifts.service";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import { RangeDatePicker } from "@/components/features/sales/RangeDatePicker";
import type { CustomRange, PresetDays } from "@/components/features/sales/RangeDatePicker";
import { Button } from "@/components/ui/Button";
import type { ShiftWithCashierName } from "@/types/shifts";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeForPreset(days: PresetDays): CustomRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

function toReportRange(range: CustomRange): { startDate: Date; endDate: Date } {
  const startDate = new Date(range.startDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(range.endDate);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

/** Admin-only list of shifts in a date range, with a force-close action on any still-open row. */
export function ShiftsList() {
  const { user, storeId } = useAuth();
  const [preset, setPreset] = useState<PresetDays | null>(7);
  const [customRange, setCustomRange] = useState<CustomRange>(rangeForPreset(7));
  const [shifts, setShifts] = useState<ShiftWithCashierName[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingShiftId, setClosingShiftId] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { startDate, endDate } = toReportRange(customRange);
      const rows = await getShiftsForReport(supabase, startDate, endDate);
      setShifts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الورديات");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customRange.startDate, customRange.endDate]);

  function handlePresetChange(days: PresetDays) {
    setPreset(days);
    setCustomRange(rangeForPreset(days));
  }

  function handleCustomRangeChange(range: CustomRange) {
    setPreset(null);
    setCustomRange(range);
  }

  async function handleForceClose(shiftId: string) {
    if (!storeId) return;
    setClosingShiftId(shiftId);
    try {
      const supabase = createClient();
      await closeShift(supabase, { shiftId, countedAmount: null }, user?.id ?? null, storeId, true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إغلاق الوردية");
    } finally {
      setClosingShiftId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <RangeDatePicker
        preset={preset}
        customRange={customRange}
        onPresetChange={handlePresetChange}
        onCustomRangeChange={handleCustomRangeChange}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {isLoading ? (
        <p className="text-sm text-gray-500">جارٍ التحميل...</p>
      ) : shifts.length === 0 ? (
        <p className="text-sm text-gray-500">لا توجد ورديات في هذه الفترة</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <div
              key={shift.id}
              className={cn(
                "rounded-xl border p-3",
                shift.status === "open"
                  ? "border-amber-300 bg-amber-50"
                  : shift.forced_closed_by
                    ? "border-purple-300 bg-purple-50"
                    : shift.difference !== null && shift.difference !== 0
                      ? "border-red-300 bg-red-50"
                      : "border-gray-200 bg-white",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-900">{shift.cashierName}</span>
                <span className="text-xs text-gray-500">{formatDateTime(shift.opened_at)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-600 sm:grid-cols-4">
                <span>افتتاحي: {formatCurrency(shift.opening_balance)}</span>
                <span>متوقع: {shift.expected_amount === null ? "—" : formatCurrency(shift.expected_amount)}</span>
                <span>
                  معدود:{" "}
                  {shift.forced_closed_by
                    ? "لم يُعد (إغلاق قسري)"
                    : shift.counted_amount === null
                      ? "—"
                      : formatCurrency(shift.counted_amount)}
                </span>
                <span className={shift.difference !== null && shift.difference !== 0 ? "font-semibold text-red-700" : ""}>
                  الفرق: {shift.difference === null ? "—" : formatCurrency(shift.difference)}
                </span>
              </div>
              {shift.status === "open" ? (
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={closingShiftId === shift.id}
                    onClick={() => handleForceClose(shift.id)}
                  >
                    {closingShiftId === shift.id ? "جارٍ الإغلاق..." : "إغلاق قسري"}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
