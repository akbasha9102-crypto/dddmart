"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Employee } from "@/services/employees.service";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ResetPasswordFormProps {
  employee: Employee;
  onSuccess: () => void;
  onCancel: () => void;
}

/** Admin sets a new password for a cashier, submitted to PATCH /api/employees/[id]. The new password is never displayed back here — the caller shows a neutral toast on success. */
export function ResetPasswordForm({ employee, onSuccess, onCancel }: ResetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState("");
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
        body: JSON.stringify({ password: newPassword.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result?.error ?? "حدث خطأ أثناء تغيير كلمة المرور");
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
        label="كلمة المرور الجديدة"
        type="text"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        minLength={6}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        required
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? "جارٍ التغيير..." : "تغيير كلمة المرور"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          إلغاء
        </Button>
      </div>
    </form>
  );
}
