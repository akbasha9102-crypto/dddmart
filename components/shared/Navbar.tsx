"use client";

import Link from "next/link";
import { PRIMARY_LINKS } from "./navLinks";

export function Navbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <Link href="/" className="text-lg font-bold text-brand-700">
        DDD Mart
      </Link>
      <nav className="hidden items-center gap-6 lg:flex">
        {PRIMARY_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="text-sm font-medium text-gray-600 hover:text-brand-700">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
