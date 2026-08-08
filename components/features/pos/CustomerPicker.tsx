"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listCustomers } from "@/services/customers.service";
import type { CustomerWithBalance } from "@/types/customer";
import { formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CustomerForm } from "@/components/features/customers/CustomerForm";

interface CustomerPickerProps {
  value: CustomerWithBalance | null;
  onChange: (customer: CustomerWithBalance | null) => void;
}

/**
 * Search + select + quick-add customer picker for the POS credit-sale flow.
 * No debounce utility exists in this repo — kept simple with a plain
 * useEffect-on-keystroke search, matching this app's scale (a single-till
 * store, not a high-QPS search box).
 */
export function CustomerPicker({ value, onChange }: CustomerPickerProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerWithBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (value) return;

    let cancelled = false;
    setIsLoading(true);

    const supabase = createClient();
    void listCustomers(supabase, { search: search || undefined })
      .then((rows) => {
        if (!cancelled) setResults(rows);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, value]);

  if (value) {
    return (
      <Card className="flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-gray-900">{value.name}</p>
            {value.phone ? <p className="text-sm text-gray-500">{value.phone}</p> : null}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange(null)}>
            تغيير
          </Button>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">الرصيد الحالي</span>
          <span className="font-medium text-gray-900">{formatCurrency(value.balance)}</span>
        </div>
        {value.credit_limit > 0 ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">حد الائتمان</span>
            <span className="font-medium text-gray-900">{formatCurrency(value.credit_limit)}</span>
          </div>
        ) : null}
      </Card>
    );
  }

  if (isAdding) {
    return (
      <CustomerForm
        onSaved={(customer) => {
          setIsAdding(false);
          onChange({ ...customer, balance: 0 });
        }}
        onCancel={() => setIsAdding(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="text"
        label="ابحث عن زبون بالاسم أو رقم الهاتف"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        autoFocus
      />

      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-2 text-center text-sm text-gray-400">جارٍ البحث...</p>
        ) : results.length === 0 ? (
          <p className="p-2 text-center text-sm text-gray-400">لا يوجد زبائن مطابقون</p>
        ) : (
          results.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => onChange(customer)}
              className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-right text-sm hover:bg-gray-50"
            >
              <span className="flex flex-col">
                <span className="font-medium text-gray-900">{customer.name}</span>
                {customer.phone ? <span className="text-xs text-gray-500">{customer.phone}</span> : null}
              </span>
              <span className="text-xs font-medium text-gray-600">{formatCurrency(customer.balance)}</span>
            </button>
          ))
        )}

        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="rounded-lg border border-dashed border-brand-300 px-3 py-2 text-center text-sm font-medium text-brand-700 hover:bg-brand-50"
        >
          + زبون جديد
        </button>
      </div>
    </div>
  );
}
