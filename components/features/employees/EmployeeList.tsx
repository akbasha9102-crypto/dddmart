"use client";

import { useState } from "react";
import { Pencil, KeyRound, Trash2, Undo2 } from "lucide-react";
import type { Employee } from "@/services/employees.service";
import { formatDate, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

interface EmployeeListProps {
  employees: Employee[];
  currentUserId: string | null;
  onEdit: (employee: Employee) => void;
  onResetPassword: (employee: Employee) => void;
  onDelete: (employee: Employee) => void;
  onRestore: (employee: Employee) => void;
  busyId: string | null;
}

/** Presentational list of employees — role badge, active/inactive status, and explicit edit/reset-password/delete/restore actions. The admin's own row shows no action buttons (self-management is blocked server-side too, so hiding here is a genuine UX affordance). */
export function EmployeeList({
  employees,
  currentUserId,
  onEdit,
  onResetPassword,
  onDelete,
  onRestore,
  busyId,
}: EmployeeListProps) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  if (employees.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا يوجد موظفون بعد</p>;
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col divide-y divide-gray-100">
        {employees.map((employee) => {
          const isSelf = employee.id === currentUserId;
          const isAdmin = employee.role === "admin";

          if (confirmingDeleteId === employee.id) {
            return (
              <div key={employee.id} className="p-2">
                <ConfirmInline
                  message={`تأكيد حذف الكاشير "${employee.full_name}"؟ راح ينحظر دخوله للنظام، بس بياناته وسجل مبيعاته يبقون محفوظين. تكدر تسترجع حسابه بعدين.`}
                  confirmLabel="حذف"
                  onConfirm={() => onDelete(employee)}
                  onCancel={() => setConfirmingDeleteId(null)}
                />
              </div>
            );
          }

          return (
            <div
              key={employee.id}
              className={cn("flex items-center justify-between gap-3 p-4", !employee.is_active && "opacity-60")}
            >
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
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                      employee.is_active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", employee.is_active ? "bg-green-600" : "bg-red-600")} />
                    {employee.is_active ? "فعّال" : "معطّل"}
                  </span>
                  <span className="text-gray-400">{formatDate(employee.created_at)}</span>
                </div>
              </div>

              {isSelf ? null : employee.is_active ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busyId === employee.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(employee);
                    }}
                    className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                    aria-label="تعديل"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === employee.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onResetPassword(employee);
                    }}
                    className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                    aria-label="إعادة تعيين كلمة المرور"
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === employee.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirmingDeleteId(employee.id);
                    }}
                    className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    aria-label="حذف"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busyId === employee.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRestore(employee);
                  }}
                  className="rounded-full p-2 text-gray-400 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                  aria-label="استعادة"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
