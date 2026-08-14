"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useStoreProfile } from "@/hooks/useStoreProfile";
import { updateStore } from "@/services/stores.service";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";

export default function StoreSettingsPage() {
  const { role, storeId } = useAuth();
  const isAdmin = role === "admin";
  const { store, isLoading, refetch } = useStoreProfile();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (store) {
      setName(store.name);
      setPhone(store.phone ?? "");
      setAddress(store.address ?? "");
    }
  }, [store]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لتعديل بيانات المتجر.</p>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!storeId) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      await updateStore(supabase, storeId, {
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
      });
      await refetch();
      setToastMessage("تم حفظ بيانات المتجر");
    } catch {
      setError("تعذّر حفظ بيانات المتجر");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToSettingsLink />
        <h1 className="text-xl font-bold text-gray-900">بيانات المتجر</h1>
      </div>

      {isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="اسم المحل" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input label="الهاتف" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <Input label="العنوان" value={address} onChange={(event) => setAddress(event.target.value)} />

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </form>
      )}

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </div>
  );
}
