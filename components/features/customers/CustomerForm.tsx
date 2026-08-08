"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createCustomer, updateCustomer } from "@/services/customers.service";
import { useAuth } from "@/context/AuthContext";
import type { Customer } from "@/types/customer";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface CustomerFormProps {
  customer?: Customer | null;
  onSaved: (customer: Customer) => void;
  onCancel: () => void;
}

/** Create/edit form for a customer (name, phone, credit limit, notes) — mirrors CategoryForm's create-or-edit shape. */
export function CustomerForm({ customer, onSaved, onCancel }: CustomerFormProps) {
  const { user, storeId } = useAuth();
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [creditLimit, setCreditLimit] = useState(String(customer?.credit_limit ?? 0));
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const supabase = createClient();
      const actorId = user?.id ?? null;

      const saved = customer
        ? await updateCustomer(
            supabase,
            customer.id,
            {
              name: name.trim(),
              phone: phone.trim() || null,
              credit_limit: Number(creditLimit) || 0,
              notes: notes.trim() || null,
            },
            actorId,
            storeId,
          )
        : await createCustomer(
            supabase,
            { name, phone: phone.trim() || null, creditLimit: Number(creditLimit) || 0, notes: notes.trim() || null },
            actorId,
            storeId,
          );

      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ بيانات الزبون");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="اسم الزبون"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        autoFocus
      />

      <Input label="رقم الهاتف (اختياري)" value={phone} onChange={(event) => setPhone(event.target.value)} />

      <Input
        type="number"
        label="حد الائتمان"
        min={0}
        value={creditLimit}
        onChange={(event) => setCreditLimit(event.target.value)}
      />

      <Input label="ملاحظات (اختياري)" value={notes} onChange={(event) => setNotes(event.target.value)} />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </div>
    </form>
  );
}
