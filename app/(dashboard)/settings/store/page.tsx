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
import { BackButton } from "@/components/ui/BackButton";
import { ChangePasswordForm } from "@/components/features/settings/ChangePasswordForm";

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
  const [passwordToastMessage, setPasswordToastMessage] = useState<string | null>(null);
  const [view, setView] = useState<"info" | "password">("info");

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
      {view === "info" ? (
        <>
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

          <div className="border-t border-gray-200 pt-6">
            <Button type="button" variant="secondary" className="w-full" onClick={() => setView("password")}>
              تغيير كلمة السر
            </Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <BackButton onClick={() => setView("info")} aria-label="رجوع لبيانات المتجر" className="mb-2" />
            <h1 className="text-xl font-bold text-gray-900">تغيير كلمة السر</h1>
          </div>

          <ChangePasswordForm
            onSuccess={() => {
              setPasswordToastMessage("تم تغيير كلمة المرور");
              setView("info");
            }}
          />
        </>
      )}

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
      {passwordToastMessage ? (
        <Toast message={passwordToastMessage} onDismiss={() => setPasswordToastMessage(null)} />
      ) : null}
    </div>
  );
}
