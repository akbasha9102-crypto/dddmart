"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { archiveCustomer } from "@/services/customers.service";
import { useAuth } from "@/context/AuthContext";
import type { CustomerWithBalance } from "@/types/customer";
import { formatCurrency, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

interface CustomerListProps {
  customers: CustomerWithBalance[];
  onSelect: (customer: CustomerWithBalance) => void;
  onEdit: (customer: CustomerWithBalance) => void;
  onDeleted: (customer: CustomerWithBalance) => void;
}

/** Presentational list of customers — mirrors EmployeeList's Card/divide layout. Clicking a row (not the pencil) selects the customer for detail view. */
export function CustomerList({ customers, onSelect, onEdit, onDeleted }: CustomerListProps) {
  const { user, storeId } = useAuth();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(customer: CustomerWithBalance) {
    if (!storeId) return;
    setBusyId(customer.id);
    try {
      const supabase = createClient();
      await archiveCustomer(supabase, customer.id, user?.id ?? null, storeId);
      setConfirmingDeleteId(null);
      onDeleted(customer);
    } finally {
      setBusyId(null);
    }
  }

  if (customers.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا يوجد زبائن بعد</p>;
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col divide-y divide-gray-100">
        {customers.map((customer) => {
          const isOverLimit = customer.credit_limit > 0 && customer.balance > customer.credit_limit;

          if (confirmingDeleteId === customer.id) {
            return (
              <div key={customer.id} className="p-2">
                <ConfirmInline
                  message={
                    customer.balance > 0
                      ? `تأكيد حذف الزبون "${customer.name}"؟ لديه رصيد مستحق قدره ${formatCurrency(customer.balance)} — سيبقى محفوظاً في السجلات ولن يظهر في القائمة.`
                      : `تأكيد حذف الزبون "${customer.name}"؟`
                  }
                  confirmLabel="حذف"
                  onConfirm={() => void handleDelete(customer)}
                  onCancel={() => setConfirmingDeleteId(null)}
                />
              </div>
            );
          }

          return (
            <div
              key={customer.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(customer)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSelect(customer);
              }}
              className="flex cursor-pointer items-center justify-between gap-3 p-4 hover:bg-gray-50"
            >
              <div className="flex flex-col gap-1">
                <p className="font-medium text-gray-900">{customer.name}</p>
                {customer.phone ? <p className="text-xs text-gray-500">{customer.phone}</p> : null}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end gap-0.5">
                  <span className={cn("text-sm font-semibold", isOverLimit ? "text-red-600" : "text-gray-900")}>
                    {formatCurrency(customer.balance)}
                  </span>
                  {customer.credit_limit > 0 ? (
                    <span className="text-xs text-gray-400">حد: {formatCurrency(customer.credit_limit)}</span>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(customer);
                  }}
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="تعديل"
                >
                  <Pencil className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  disabled={busyId === customer.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setConfirmingDeleteId(customer.id);
                  }}
                  className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  aria-label="حذف"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
