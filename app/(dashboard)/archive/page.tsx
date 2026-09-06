"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listOperations } from "@/services/archive.service";
import type { OperationLogWithActor } from "@/types/archive";
import type { OperationEntityType } from "@/types/database.types";
import { ArchiveList } from "@/components/features/archive/ArchiveList";
import { cn } from "@/lib/utils";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

type RangeOption = "today" | "7" | "30" | "all" | "custom";

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "7", label: "آخر 7 أيام" },
  { value: "30", label: "آخر 30 يوماً" },
  { value: "all", label: "الكل" },
  { value: "custom", label: "تحديد" },
];

interface CustomArchiveRange {
  startDate: string;
  endDate: string;
}

const ENTITY_OPTIONS: { value: OperationEntityType | "all"; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "product", label: "منتجات" },
  { value: "category", label: "أقسام" },
  { value: "sale", label: "مبيعات" },
  { value: "stock", label: "مخزون" },
];

function rangeToStartDate(range: RangeOption): Date | undefined {
  if (range === "all") return undefined;

  const startDate = new Date();
  if (range === "today") {
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }

  const days = range === "7" ? 7 : 30;
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  return startDate;
}

// Mirrors toExportRange in components/features/sales/SalesExportModal.tsx (not imported to avoid
// a cross-feature type/util dependency beyond the precedented RangeDatePicker component reuse) —
// extends the end date to end-of-day so a same-day range doesn't collapse to a zero-width query window.
function toArchiveQueryRange(customRange: CustomArchiveRange): { startDate: Date; endDate: Date } {
  const startDate = new Date(customRange.startDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(customRange.endDate);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

export default function ArchivePage() {
  const [range, setRange] = useState<RangeOption>("today");
  const [customRange, setCustomRange] = useState<CustomArchiveRange>({ startDate: "", endDate: "" });
  const [entityType, setEntityType] = useState<OperationEntityType | "all">("all");
  const [operations, setOperations] = useState<OperationLogWithActor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (range === "custom" && (!customRange.startDate || !customRange.endDate)) {
      return;
    }
    setIsLoading(true);
    const supabase = createClient();
    const { startDate, endDate } =
      range === "custom"
        ? toArchiveQueryRange(customRange)
        : { startDate: rangeToStartDate(range), endDate: undefined };
    const data = await listOperations(supabase, {
      startDate,
      endDate,
      entityType: entityType === "all" ? undefined : entityType,
    });
    setOperations(data);
    setIsLoading(false);
  }, [range, customRange, entityType]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="flex flex-col gap-4">
      <BackToSettingsLink />
      <h1 className="text-xl font-bold text-gray-900">الأرشيف</h1>

      <div className="flex flex-col gap-2">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRange(option.value)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                range === option.value
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-gray-200 bg-white text-gray-600",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {range === "custom" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <label className="flex items-center gap-2">
              من
              <input
                type="date"
                value={customRange.startDate}
                max={customRange.endDate || undefined}
                onChange={(event) => setCustomRange({ ...customRange, startDate: event.target.value })}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex items-center gap-2">
              إلى
              <input
                type="date"
                value={customRange.endDate}
                min={customRange.startDate || undefined}
                onChange={(event) => setCustomRange({ ...customRange, endDate: event.target.value })}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        ) : null}

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {ENTITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setEntityType(option.value)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                entityType === option.value
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-gray-200 bg-white text-gray-600",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : (
        <ArchiveList operations={operations} />
      )}
    </div>
  );
}
