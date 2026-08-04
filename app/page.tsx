import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <h1 className="text-3xl font-bold text-brand-700">DDD Mart</h1>
        <p className="mt-2 text-gray-600">نظام إدارة المحلات والماركتات</p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/pos"
          className="rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
        >
          فتح شاشة الكاشير
        </Link>
        <Link
          href="/inventory"
          className="rounded-lg border border-brand-600 px-6 py-3 font-semibold text-brand-700 hover:bg-brand-50"
        >
          لوحة التحكم
        </Link>
      </div>
    </main>
  );
}
