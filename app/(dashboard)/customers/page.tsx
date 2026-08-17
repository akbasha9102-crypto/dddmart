"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCustomer } from "@/services/customers.service";
import type { CustomerDetail as CustomerDetailData } from "@/services/customers.service";
import { useCustomers } from "@/hooks/useCustomers";
import type { Customer, CustomerWithBalance } from "@/types/customer";
import { CustomerList } from "@/components/features/customers/CustomerList";
import { CustomerDetail } from "@/components/features/customers/CustomerDetail";
import { CustomerForm } from "@/components/features/customers/CustomerForm";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toast } from "@/components/ui/Toast";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const customers = useCustomers(search || undefined);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  async function loadDetail(id: string) {
    setIsLoadingDetail(true);
    try {
      const supabase = createClient();
      const result = await getCustomer(supabase, id);
      setDetail(result);
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function handleSelect(customer: CustomerWithBalance) {
    setSelectedCustomerId(customer.id);
    void loadDetail(customer.id);
  }

  function handleEdit(customer: CustomerWithBalance) {
    setEditingCustomer(customer);
    setIsFormModalOpen(true);
  }

  function handleDeleted(customer: CustomerWithBalance) {
    setToastMessage(`تم حذف الزبون "${customer.name}"`);
    void customers.reload();
  }

  function openAddModal() {
    setEditingCustomer(null);
    setIsFormModalOpen(true);
  }

  function handleBack() {
    setSelectedCustomerId(null);
    setDetail(null);
  }

  if (selectedCustomerId) {
    return (
      <div className="flex flex-col gap-6">
        {isLoadingDetail || !detail ? (
          <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
        ) : (
          <CustomerDetail
            detail={detail}
            onBack={handleBack}
            onChanged={() => {
              void loadDetail(selectedCustomerId);
              void customers.reload();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToSettingsLink />
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">الزبائن</h1>
          <Button size="sm" onClick={openAddModal}>
            + زبون جديد
          </Button>
        </div>
      </div>

      <Input
        type="text"
        placeholder="ابحث بالاسم أو رقم الهاتف"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {customers.isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : customers.error ? (
        <p className="p-6 text-center text-red-600">{customers.error}</p>
      ) : (
        <CustomerList customers={customers.data} onSelect={handleSelect} onEdit={handleEdit} onDeleted={handleDeleted} />
      )}

      <Modal
        open={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={editingCustomer ? "تعديل بيانات الزبون" : "زبون جديد"}
      >
        <CustomerForm
          customer={editingCustomer}
          onSaved={() => {
            setIsFormModalOpen(false);
            void customers.reload();
          }}
          onCancel={() => setIsFormModalOpen(false)}
        />
      </Modal>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </div>
  );
}
