"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

interface SidebarLink {
  href: string;
  label: string;
}

const LINKS: SidebarLink[] = [
  { href: "/pos", label: "الكاشير" },
  { href: "/inventory", label: "المنتجات" },
  { href: "/sales", label: "تقارير المبيعات" },
  { href: "/archive", label: "الأرشيف" },
];

export function Sidebar({ activeHref }: { activeHref?: string }) {
  const { role } = useAuth();
  const links = LINKS.filter((link) => link.href !== "/sales" || role === "admin");

  return (
    <aside className="hidden w-56 shrink-0 border-l border-gray-200 bg-white p-4 md:block">
      <nav className="flex flex-col gap-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100",
              activeHref === link.href && "bg-brand-50 text-brand-700",
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
