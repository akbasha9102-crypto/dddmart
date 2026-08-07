"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });

    setIsSubmitting(false);

    if (signInError) {
      setError("بيانات الدخول غير صحيحة");
      return;
    }

    router.replace("/pos");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="mb-1 text-center text-2xl font-bold text-brand-700">DDD Mart</h1>
        <p className="mb-6 text-center text-sm text-gray-500">تسجيل دخول الموظفين</p>

        <div className="flex flex-col gap-4">
          <Input
            id="email"
            type="email"
            label="البريد الإلكتروني"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
          <Input
            id="password"
            type="password"
            label="كلمة المرور"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "جارِ الدخول..." : "دخول"}
          </Button>
        </div>
      </form>
    </main>
  );
}
