"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface AddEmployeeFormProps {
  onSuccess: () => void;
}

/** Create-cashier form: full name / email / temporary password, submitted to POST /api/employees. The owner picks the password and hands it to the cashier directly. */
export function AddEmployeeForm({ onSuccess }: AddEmployeeFormProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim(), email: email.trim(), password: password.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result?.error ?? "حدث خطأ أثناء إنشاء الحساب");
        return;
      }

      setSuccessMessage("تم إنشاء الحساب، أعطي هذه البيانات للكاشير");
      setFullName("");
      setEmail("");
      setPassword("");
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
        label="الإيميل"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        required
      />
      <Input
        label="كلمة المرور المؤقتة"
        type="text"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        minLength={6}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        required
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {successMessage ? <p className="text-sm text-green-700">{successMessage}</p> : null}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "جارٍ الإنشاء..." : "إنشاء الحساب"}
      </Button>
    </form>
  );
}
