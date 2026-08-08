import { ShoppingCart, Package, Settings as SettingsIcon, BarChart3, Users, Archive as ArchiveIcon, Landmark, type LucideIcon } from "lucide-react";

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
  { href: "/settings", label: "الإعدادات", icon: SettingsIcon },
];

/** Links shown inside the /settings page. adminOnly links are hidden from cashiers there. */
export const SETTINGS_LINKS: SettingsLink[] = [
  { href: "/sales", label: "المبيعات", adminOnly: true, icon: BarChart3 },
  { href: "/customers", label: "الزبائن", adminOnly: false, icon: Landmark },
  { href: "/archive", label: "الأرشيف", adminOnly: false, icon: ArchiveIcon },
  { href: "/employees", label: "الموظفون", adminOnly: true, icon: Users },
];

const SETTINGS_PATHS = ["/settings", "/sales", "/customers", "/archive", "/employees"];

/** True when pathname is /settings or any page reachable from it — used to keep the "الإعدادات" tab visually active on its sub-pages. */
export function isSettingsPath(pathname: string): boolean {
  return SETTINGS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** SETTINGS_LINKS filtered down to what `role` is allowed to see. */
export function visibleSettingsLinks(role: string | null): SettingsLink[] {
  return SETTINGS_LINKS.filter((link) => !link.adminOnly || role === "admin");
}
