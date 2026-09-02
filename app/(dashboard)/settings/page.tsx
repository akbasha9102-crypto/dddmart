"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { visibleSettingsLinks } from "@/components/shared/navLinks";

export default function SettingsPage() {
  const { role } = useAuth();
  const router = useRouter();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const links = visibleSettingsLinks(role);

  async function handleLogout() {
    setLogoutError(null);
    setIsLoggingOut(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      setLogoutError("تعذّر تسجيل الخروج، حاول مرة ثانية");
      setIsLoggingOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-gray-900">عام</h1>

      <div className="flex flex-col gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex h-14 items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 text-base font-medium text-gray-900 hover:bg-gray-50"
            >
              <Icon className="h-5 w-5 text-gray-500" />
              {link.label}
            </Link>
          );
        })}
      </div>

      {logoutError ? <p className="text-sm text-red-600">{logoutError}</p> : null}

      <Button variant="secondary" size="lg" onClick={handleLogout} disabled={isLoggingOut} className="w-full">
        {isLoggingOut ? "جارٍ تسجيل الخروج..." : "تسجيل خروج"}
      </Button>
    </div>
  );
}
