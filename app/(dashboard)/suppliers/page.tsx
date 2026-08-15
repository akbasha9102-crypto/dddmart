"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSuppliers } from "@/hooks/useSuppliers";
import type { Supplier, SupplierWithBalance } from "@/types/supplier";
import { SupplierList } from "@/components/features/suppliers/SupplierList";
import { SupplierForm } from "@/components/features/suppliers/SupplierForm";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

export default function SuppliersPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [search, setSearch] = useState("");
  const suppliers = useSuppliers(search || undefined);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لإدارة الموردين.</p>
      </div>
    );
  }

  function handleSelect(_supplier: SupplierWithBalance) {
    // Wired up in the next task alongside SupplierDetail.
  }

  function handleEdit(supplier: SupplierWithBalance) {
    setEditingSupplier(supplier);
    setIsFormModalOpen(true);
  }

  function openAddModal() {
    setEditingSupplier(null);
    setIsFormModalOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToSettingsLink />
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">الموردون</h1>
          <Button size="sm" onClick={openAddModal}>
            + مورد جديد
          </Button>
        </div>
      </div>

      <Input
        type="text"
        placeholder="ابحث بالاسم أو رقم الهاتف"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {suppliers.isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : suppliers.error ? (
        <p className="p-6 text-center text-red-600">{suppliers.error}</p>
      ) : (
        <SupplierList suppliers={suppliers.data} onSelect={handleSelect} onEdit={handleEdit} />
      )}

      <Modal
        open={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={editingSupplier ? "تعديل بيانات المورد" : "مورد جديد"}
      >
        <SupplierForm
          supplier={editingSupplier}
          onSaved={() => {
            setIsFormModalOpen(false);
            void suppliers.reload();
          }}
          onCancel={() => setIsFormModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
