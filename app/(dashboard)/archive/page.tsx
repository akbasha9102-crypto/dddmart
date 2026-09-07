"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listOperations } from "@/services/archive.service";
import type { OperationLogWithActor } from "@/types/archive";
import type { OperationEntityType } from "@/types/database.types";
import { ArchiveList } from "@/components/features/archive/ArchiveList";
import { cn } from "@/lib/utils";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";
import { endOfDay, startOfDay } from "@/lib/dateRange";

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

  if (range === "today") {
    return startOfDay(new Date());
  }

  const days = range === "7" ? 7 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  return startOfDay(startDate);
}

function toArchiveQueryRange(customRange: CustomArchiveRange): { startDate: Date; endDate: Date } {
  return {
    startDate: startOfDay(new Date(customRange.startDate)),
    endDate: endOfDay(new Date(customRange.endDate)),
  };
}

export default function ArchivePage() {
  const [range, setRange] = useState<RangeOption>("today");
  const [customRange, setCustomRange] = useState<CustomArchiveRange>({ startDate: "", endDate: "" });
  const [entityType, setEntityType] = useState<OperationEntityType | "all">("all");
  const [operations, setOperations] = useState<OperationLogWithActor[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const buildFilter = useCallback(
    (pageIndex: number) => {
      const { startDate, endDate } =
        range === "custom"
          ? toArchiveQueryRange(customRange)
          : { startDate: rangeToStartDate(range), endDate: undefined };
      return {
        startDate,
        endDate,
        entityType: entityType === "all" ? undefined : entityType,
        page: pageIndex,
      };
    },
    [range, customRange, entityType],
  );

  useEffect(() => {
    if (range === "custom" && (!customRange.startDate || !customRange.endDate)) return;

    let cancelled = false;
    setIsLoading(true);
    setOperations([]);
    setPage(0);
    setHasMore(true);

    const supabase = createClient();
    void listOperations(supabase, buildFilter(0)).then(({ operations: data, hasMore: more }) => {
      if (cancelled) return;
      setOperations(data);
      setHasMore(more);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [range, customRange, entityType, buildFilter]);

  const loadNextPage = useCallback(async () => {
    if (isLoading || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const nextPage = page + 1;
    const supabase = createClient();
    const { operations: data, hasMore: more } = await listOperations(supabase, buildFilter(nextPage));
    setOperations((prev) => [...prev, ...data]);
    setPage(nextPage);
    setHasMore(more);
    setIsLoadingMore(false);
  }, [isLoading, isLoadingMore, hasMore, page, buildFilter]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadNextPage]);

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
        <>
          <ArchiveList operations={operations} />
          {hasMore ? (
            <div ref={sentinelRef} className="flex justify-center p-4">
              {isLoadingMore ? <p className="text-sm text-gray-400">جارٍ تحميل المزيد...</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
