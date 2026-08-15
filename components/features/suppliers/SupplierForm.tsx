"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createSupplier, updateSupplier } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import type { Supplier } from "@/types/supplier";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface SupplierFormProps {
  supplier?: Supplier | null;
  onSaved: (supplier: Supplier) => void;
  onCancel: () => void;
}

/** Create/edit form for a supplier (name, phone, address, note, opening balance) — mirrors CustomerForm's create-or-edit shape. */
export function SupplierForm({ supplier, onSaved, onCancel }: SupplierFormProps) {
  const { user, storeId } = useAuth();
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [note, setNote] = useState(supplier?.note ?? "");
  const [openingBalance, setOpeningBalance] = useState(String(supplier?.opening_balance ?? 0));
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

      const saved = supplier
        ? await updateSupplier(
            supabase,
            supplier.id,
            {
              name: name.trim(),
              phone: phone.trim() || null,
              address: address.trim() || null,
              note: note.trim() || null,
              opening_balance: Number(openingBalance) || 0,
            },
            actorId,
            storeId,
          )
        : await createSupplier(
            supabase,
            {
              name,
              phone: phone.trim() || null,
              address: address.trim() || null,
              note: note.trim() || null,
              openingBalance: Number(openingBalance) || 0,
            },
            actorId,
            storeId,
          );

      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ بيانات المورد");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input label="اسم المورد" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />

      <Input label="رقم الهاتف (اختياري)" value={phone} onChange={(event) => setPhone(event.target.value)} />

      <Input label="العنوان (اختياري)" value={address} onChange={(event) => setAddress(event.target.value)} />

      <Input
        type="number"
        label="الرصيد الافتتاحي (دين سابق قبل النظام)"
        min={0}
        value={openingBalance}
        onChange={(event) => setOpeningBalance(event.target.value)}
      />

      <Input label="ملاحظات (اختياري)" value={note} onChange={(event) => setNote(event.target.value)} />

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
