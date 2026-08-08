"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";

/**
 * Client-side UX polish, not the enforcement boundary — the middleware
 * (lib/supabase/middleware.ts) already blocks every navigation and every
 * /api/* call for a suspended store. This guard only covers the rare case
 * of a cashier already mid-session when a store gets suspended, showing the
 * same paused message immediately instead of a confusing screen until the
 * next navigation/refresh.
 */
export function StoreActiveGuard({ children }: { children: ReactNode }) {
  const { storeActive, isLoading } = useAuth();

  if (!isLoading && !storeActive) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="mb-2 text-2xl font-bold text-brand-700">DDD Mart</h1>
          <p className="mb-2 text-lg font-semibold text-gray-800">الاشتراك متوقف مؤقتًا</p>
          <p className="text-sm text-gray-500">
            تم إيقاف اشتراك هذا المتجر مؤقتًا، ولا يمكن استخدام النظام حاليًا. يرجى التواصل مع الدعم لإعادة تفعيل
            الاشتراك.
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
