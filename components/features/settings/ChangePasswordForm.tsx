"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ChangePasswordFormProps {
  onSuccess: () => void;
}

export function ChangePasswordForm({ onSuccess }: ChangePasswordFormProps) {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!user?.email) {
      setError("تعذّر التحقق من هوية المستخدم");
      return;
    }

    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      setError("الرجاء تعبئة جميع الحقول");
      return;
    }

    if (newPassword.trim().length < 6) {
      setError("كلمة المرور الجديدة قصيرة جداً، لازم تكون 6 أحرف على الأقل");
      return;
    }

    if (newPassword.trim() !== confirmPassword.trim()) {
      setError("كلمتا المرور الجديدتان غير متطابقتين");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword.trim(),
      });

      if (signInError) {
        setError("كلمة المرور الحالية غير صحيحة");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword.trim(),
      });

      if (updateError) {
        setError("تعذّر تغيير كلمة المرور");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
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
        label="كلمة المرور الحالية"
        type="password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        autoComplete="current-password"
        required
      />
      <Input
        label="كلمة المرور الجديدة"
        type="password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        minLength={6}
        autoComplete="new-password"
        required
      />
      <Input
        label="تأكيد كلمة المرور الجديدة"
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        minLength={6}
        autoComplete="new-password"
        required
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "جارٍ التغيير..." : "تغيير كلمة المرور"}
      </Button>
    </form>
  );
}
