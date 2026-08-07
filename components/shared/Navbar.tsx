"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export const NAV_LINKS = [
  { href: "/pos", label: "الكاشير" },
  { href: "/inventory", label: "المخزون" },
  { href: "/sales", label: "المبيعات" },
  { href: "/archive", label: "الأرشيف" },
];

/** Filters NAV_LINKS down to what `role` is allowed to see — shared by Navbar and BottomNav.tsx (which imports NAV_LINKS directly and must filter it itself). */
export function visibleNavLinks(role: string | null) {
  return NAV_LINKS.filter((link) => link.href !== "/sales" || role === "admin");
}

export function Navbar() {
  const { role } = useAuth();
  const links = visibleNavLinks(role);

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <Link href="/" className="text-lg font-bold text-brand-700">
        DDD Mart
      </Link>
      <nav className="hidden items-center gap-6 md:flex">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="text-sm font-medium text-gray-600 hover:text-brand-700">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
