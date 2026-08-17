"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useEmployees } from "@/hooks/useEmployees";
import type { Employee } from "@/services/employees.service";
import { EmployeeList } from "@/components/features/employees/EmployeeList";
import { AddEmployeeForm } from "@/components/features/employees/AddEmployeeForm";
import { EditEmployeeForm } from "@/components/features/employees/EditEmployeeForm";
import { ResetPasswordForm } from "@/components/features/employees/ResetPasswordForm";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

export default function EmployeesPage() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";

  const employees = useEmployees();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [resettingPasswordFor, setResettingPasswordFor] = useState<Employee | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لإدارة الموظفين.</p>
      </div>
    );
  }

  async function handleDelete(employee: Employee) {
    setActionError(null);
    setBusyId(employee.id);
    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      const result = await response.json();
      if (!response.ok) {
        setActionError(result?.error ?? "حدث خطأ أثناء حذف الكاشير");
        return;
      }
      setToastMessage(`تم حذف الكاشير "${employee.full_name}"`);
      await employees.reload();
    } catch {
      setActionError("تعذّر الاتصال بالسيرفر");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(employee: Employee) {
    setActionError(null);
    setBusyId(employee.id);
    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const result = await response.json();
      if (!response.ok) {
        setActionError(result?.error ?? "حدث خطأ أثناء استرجاع الحساب");
        return;
      }
      setToastMessage(`تم استرجاع حساب "${employee.full_name}"`);
      await employees.reload();
    } catch {
      setActionError("تعذّر الاتصال بالسيرفر");
    } finally {
      setBusyId(null);
    }
  }

  function handleEdit(employee: Employee) {
    setEditingEmployee(employee);
  }

  function handleResetPassword(employee: Employee) {
    setResettingPasswordFor(employee);
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

      {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}

      {employees.isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : employees.error ? (
        <p className="p-6 text-center text-red-600">{employees.error}</p>
      ) : (
        <EmployeeList
          employees={employees.data}
          currentUserId={user?.id ?? null}
          onEdit={handleEdit}
          onResetPassword={handleResetPassword}
          onDelete={handleDelete}
          onRestore={handleRestore}
          busyId={busyId}
        />
      )}

      <Modal open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="إضافة كاشير">
        <AddEmployeeForm
          onSuccess={() => {
            void employees.reload();
          }}
        />
      </Modal>

      <Modal open={!!editingEmployee} onClose={() => setEditingEmployee(null)} title="تعديل بيانات الكاشير">
        {editingEmployee ? (
          <EditEmployeeForm
            employee={editingEmployee}
            onCancel={() => setEditingEmployee(null)}
            onSuccess={() => {
              setEditingEmployee(null);
              setToastMessage("تم تحديث بيانات الكاشير");
              void employees.reload();
            }}
          />
        ) : null}
      </Modal>

      <Modal open={!!resettingPasswordFor} onClose={() => setResettingPasswordFor(null)} title="إعادة تعيين كلمة المرور">
        {resettingPasswordFor ? (
          <ResetPasswordForm
            employee={resettingPasswordFor}
            onCancel={() => setResettingPasswordFor(null)}
            onSuccess={() => {
              setResettingPasswordFor(null);
              setToastMessage("تم تغيير كلمة المرور");
            }}
          />
        ) : null}
      </Modal>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </div>
  );
}
