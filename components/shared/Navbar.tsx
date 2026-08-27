"use client";

import Link from "next/link";
import { PRIMARY_LINKS } from "./navLinks";
import { BrandName } from "@/components/shared/BrandName";

export function Navbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <Link href="/" className="text-lg font-bold text-brand-700">
        <BrandName />
      </Link>
      <nav className="hidden items-center gap-6 lg:flex">
        {PRIMARY_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-brand-700"
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
