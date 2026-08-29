"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { getEmployee } from "@/services/employees.service";
import type { Employee } from "@/services/employees.service";
import { listOperations } from "@/services/archive.service";
import type { OperationLogWithActor } from "@/types/archive";
import { ArchiveList } from "@/components/features/archive/ArchiveList";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";
import { cn } from "@/lib/utils";

type RangeOption = "today" | "7" | "30" | "all";

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "7", label: "آخر 7 أيام" },
  { value: "30", label: "آخر 30 يوماً" },
  { value: "all", label: "الكل" },
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

export default function EmployeeDetailPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const params = useParams<{ id: string }>();
  const employeeId = params.id;

  const [range, setRange] = useState<RangeOption>("today");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [operations, setOperations] = useState<OperationLogWithActor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const [employeeResult, operationsResult] = await Promise.all([
      getEmployee(supabase, employeeId),
      listOperations(supabase, { userId: employeeId, startDate: rangeToStartDate(range) }),
    ]);
    setEmployee(employeeResult);
    setOperations(operationsResult);
    setIsLoading(false);
  }, [employeeId, range]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لإدارة الموظفين.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackToSettingsLink href="/employees" label="الموظفون" />

      {isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : !employee ? (
        <p className="p-6 text-center text-gray-400">الموظف غير موجود</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{employee.full_name}</h1>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                employee.role === "admin" ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600",
              )}
            >
              {employee.role === "admin" ? "المالك" : "كاشير"}
            </span>
          </div>

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

          <ArchiveList operations={operations} />
        </>
      )}
    </div>
  );
}
