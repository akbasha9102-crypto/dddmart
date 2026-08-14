"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listOperations } from "@/services/archive.service";
import type { OperationLogWithActor } from "@/types/archive";
import type { OperationEntityType } from "@/types/database.types";
import { ArchiveList } from "@/components/features/archive/ArchiveList";
import { cn } from "@/lib/utils";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

type RangeOption = "today" | "7" | "30" | "all";

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "7", label: "آخر 7 أيام" },
  { value: "30", label: "آخر 30 يوماً" },
  { value: "all", label: "الكل" },
];

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

export default function ArchivePage() {
  const [range, setRange] = useState<RangeOption>("today");
  const [entityType, setEntityType] = useState<OperationEntityType | "all">("all");
  const [operations, setOperations] = useState<OperationLogWithActor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const data = await listOperations(supabase, {
      startDate: rangeToStartDate(range),
      entityType: entityType === "all" ? undefined : entityType,
    });
    setOperations(data);
    setIsLoading(false);
  }, [range, entityType]);

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
