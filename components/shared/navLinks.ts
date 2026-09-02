import { ShoppingCart, Package, Menu, BarChart3, Users, Archive as ArchiveIcon, Landmark, Store, Truck, Wallet, type LucideIcon } from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface SettingsLink extends NavLink {
  adminOnly: boolean;
}

/** The three top-level tabs shown to every user, in every nav surface (BottomNav, Navbar, Sidebar). */
export const PRIMARY_LINKS: NavLink[] = [
  { href: "/pos", label: "الكاشير", icon: ShoppingCart },
  { href: "/inventory", label: "المخزون", icon: Package },
  { href: "/settings", label: "عام", icon: Menu },
];

/** Links shown inside the /settings page. adminOnly links are hidden from cashiers there. */
export const SETTINGS_LINKS: SettingsLink[] = [
  { href: "/sales", label: "المبيعات", adminOnly: true, icon: BarChart3 },
  { href: "/shifts", label: "الورديات", adminOnly: true, icon: Wallet },
  { href: "/customers", label: "الزبائن", adminOnly: false, icon: Landmark },
  { href: "/archive", label: "الأرشيف", adminOnly: false, icon: ArchiveIcon },
  { href: "/employees", label: "الموظفون", adminOnly: true, icon: Users },
  { href: "/suppliers", label: "الموردون", adminOnly: true, icon: Truck },
  { href: "/settings/store", label: "بيانات المتجر", adminOnly: true, icon: Store },
];

const SETTINGS_PATHS = ["/settings", "/sales", "/shifts", "/customers", "/archive", "/employees", "/settings/store", "/suppliers"];

/** True when pathname is /settings or any page reachable from it — used to keep the "عام" tab visually active on its sub-pages. */
export function isSettingsPath(pathname: string): boolean {
  return SETTINGS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** SETTINGS_LINKS filtered down to what `role` is allowed to see. */
export function visibleSettingsLinks(role: string | null): SettingsLink[] {
  return SETTINGS_LINKS.filter((link) => !link.adminOnly || role === "admin");
}
