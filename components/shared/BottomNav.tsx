"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "./Navbar";

/** Fixed bottom tab bar for mobile — primary navigation on small screens. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 min-h-14 border-t border-gray-200 bg-white md:hidden">
      {NAV_LINKS.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-sm font-medium text-gray-500",
              isActive && "text-brand-700",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
