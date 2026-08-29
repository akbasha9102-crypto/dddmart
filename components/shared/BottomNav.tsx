"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PRIMARY_LINKS, isSettingsPath } from "./navLinks";

/** Fixed bottom tab bar — primary navigation on phones and tablets (lg:hidden on large desktop screens). */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 min-h-14 border-t border-gray-200 bg-white lg:hidden">
      {PRIMARY_LINKS.map((link) => {
        const isActive =
          link.href === "/settings"
            ? isSettingsPath(pathname)
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-sm font-medium text-gray-500",
              isActive && "font-bold text-brand-700",
            )}
          >
            <Icon className="h-5 w-5" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
