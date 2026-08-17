"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Employee } from "@/services/employees.service";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface EditEmployeeFormProps {
  employee: Employee;
  onSuccess: () => void;
  onCancel: () => void;
}

/** Edit-cashier form: full name (prefilled) and an optional new email, submitted to PATCH /api/employees/[id]. There's no way to read a cashier's current email client-side (it lives only in auth.users, not profiles), so the email field is left blank and blank means "don't change email". */
export function EditEmployeeForm({ employee, onSuccess, onCancel }: EditEmployeeFormProps) {
  const [fullName, setFullName] = useState(employee.full_name);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim(), ...(email.trim() && { email: email.trim() }) }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result?.error ?? "حدث خطأ أثناء تحديث بيانات الكاشير");
        return;
      }

      onSuccess();
    } catch {
      setError("تعذّر الاتصال بالسيرفر");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="الاسم الكامل"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        required
      />
      <Input
        label="الإيميل الجديد (اختياري)"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="اتركه فارغاً لعدم التغيير"
        autoCapitalize="off"
        autoCorrect="off"
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          إلغاء
        </Button>
      </div>
    </form>
  );
}
