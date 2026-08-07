"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useEmployees } from "@/hooks/useEmployees";
import type { Employee } from "@/services/employees.service";
import { EmployeeList } from "@/components/features/employees/EmployeeList";
import { AddEmployeeForm } from "@/components/features/employees/AddEmployeeForm";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

export default function EmployeesPage() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";

  const employees = useEmployees();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لإدارة الموظفين.</p>
      </div>
    );
  }

  async function handleToggle(employee: Employee) {
    setToggleError(null);
    const nextIsActive = !employee.is_active;

    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextIsActive }),
      });

      const result = await response.json();

      if (!response.ok) {
        setToggleError(result?.error ?? "حدث خطأ أثناء تحديث حالة الحساب");
        return;
      }

      await employees.reload();
    } catch {
      setToggleError("تعذّر الاتصال بالسيرفر");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToSettingsLink />
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">الموظفون</h1>
          <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
            + إضافة كاشير
          </Button>
        </div>
      </div>

      {toggleError ? <p className="text-sm text-red-600">{toggleError}</p> : null}

      {employees.isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : employees.error ? (
        <p className="p-6 text-center text-red-600">{employees.error}</p>
      ) : (
        <EmployeeList employees={employees.data} currentUserId={user?.id ?? null} onToggle={handleToggle} />
      )}

      <Modal open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="إضافة كاشير">
        <AddEmployeeForm
          onSuccess={() => {
            void employees.reload();
          }}
        />
      </Modal>
    </div>
  );
}
