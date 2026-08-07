"use client";

import type { Employee } from "@/services/employees.service";
import { formatDate, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface EmployeeListProps {
  employees: Employee[];
  currentUserId: string | null;
  onToggle: (employee: Employee) => void;
}

/** Presentational list of employees — role badge, active/inactive indicator, tap to toggle activation. The admin's own row disables the toggle client-side as a UX nicety (the server-side self-lockout check is the real enforcement). */
export function EmployeeList({ employees, currentUserId, onToggle }: EmployeeListProps) {
  if (employees.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا يوجد موظفون بعد</p>;
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col divide-y divide-gray-100">
        {employees.map((employee) => {
          const isSelf = employee.id === currentUserId;
          const isAdmin = employee.role === "admin";

          return (
            <div key={employee.id} className="flex items-center justify-between gap-3 p-4">
              <div className="flex flex-col gap-1">
                <p className="font-medium text-gray-900">
                  {employee.full_name}
                  {isSelf ? <span className="mr-1 text-xs text-gray-400">(أنت)</span> : null}
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-medium",
                      isAdmin ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600",
                    )}
                  >
                    {isAdmin ? "المالك" : "كاشير"}
                  </span>
                  <span className="text-gray-400">{formatDate(employee.created_at)}</span>
                </div>
              </div>

              <button
                type="button"
                disabled={isSelf}
                onClick={() => onToggle(employee)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  employee.is_active
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", employee.is_active ? "bg-green-600" : "bg-red-600")} />
                {employee.is_active ? "فعّال" : "معطّل"}
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
