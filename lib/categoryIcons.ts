import {
  Carrot,
  Beef,
  Milk,
  Egg,
  Croissant,
  ShoppingBasket,
  Package,
  Flame,
  Droplet,
  Wheat,
  CupSoda,
  Citrus,
  Candy,
  Cookie,
  SprayCan,
  Sparkles,
  Cigarette,
  Pencil,
  Ellipsis,
  type LucideIcon,
} from "lucide-react";

/**
 * Kebab-case string keys are this app's own vocabulary and are what's
 * persisted in the DB categories.icon column (see migration
 * 00000000000004) — keep these keys stable even if the underlying lucide
 * component changes. "can" maps to the closest available export (Package),
 * since lucide-react has no literal "Can" icon.
 */
export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  carrot: Carrot,
  beef: Beef,
  milk: Milk,
  egg: Egg,
  croissant: Croissant,
  "shopping-basket": ShoppingBasket,
  can: Package,
  flame: Flame,
  droplet: Droplet,
  wheat: Wheat,
  "cup-soda": CupSoda,
  citrus: Citrus,
  candy: Candy,
  cookie: Cookie,
  "spray-can": SprayCan,
  sparkles: Sparkles,
  cigarette: Cigarette,
  pencil: Pencil,
  ellipsis: Ellipsis,
};

export const CATEGORY_ICON_CHOICES = Object.keys(CATEGORY_ICON_MAP);

export function getCategoryIcon(iconKey: string): LucideIcon {
  return CATEGORY_ICON_MAP[iconKey] ?? ShoppingBasket;
}
