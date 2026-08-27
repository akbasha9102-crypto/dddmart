/**
 * Shown when the caller's store subscription is paused (stores.is_active =
 * false). No data fetching here on purpose — middleware has already
 * confirmed the store is suspended before ever redirecting here, and this
 * page's own path is public (see PUBLIC_PATHS in lib/supabase/middleware.ts)
 * so it never itself gets caught in the redirect it's the target of.
 */
import { BrandName } from "@/components/shared/BrandName";

export default function SubscriptionPausedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-bold text-brand-700">
          <BrandName />
        </h1>
        <p className="mb-2 text-lg font-semibold text-gray-800">الاشتراك متوقف مؤقتًا</p>
        <p className="text-sm text-gray-500">
          تم إيقاف اشتراك هذا المتجر مؤقتًا، ولا يمكن استخدام النظام حاليًا. يرجى التواصل مع الدعم لإعادة تفعيل الاشتراك.
        </p>
      </div>
    </main>
  );
}
