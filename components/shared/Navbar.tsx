import Link from "next/link";

export const NAV_LINKS = [
  { href: "/pos", label: "الكاشير" },
  { href: "/inventory", label: "المخزون" },
  { href: "/sales", label: "المبيعات" },
];

export function Navbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <Link href="/" className="text-lg font-bold text-brand-700">
        DDD Mart
      </Link>
      <nav className="hidden items-center gap-6 md:flex">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="text-sm font-medium text-gray-600 hover:text-brand-700">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
