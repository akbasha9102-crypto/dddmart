import type { Category } from "@/types/product";

export interface CategoryGroup<T> {
  id: string;
  label: string;
  color: string;
  icon: string;
  products: T[];
}

export const OTHER_CATEGORY_ID = "__other__";
export const OTHER_CATEGORY_LABEL = "أخرى";
export const OTHER_CATEGORY_COLOR = "#57534e";
export const OTHER_CATEGORY_ICON = "ellipsis";

export const ALL_CATEGORY_ID = "__all__";
export const ALL_CATEGORY_LABEL = "الكل";

/**
 * Groups a product list by category (sorted by sort_order), appending an
 * "أخرى" group for products with no category_id. Shared by
 * CategoryProductList and ManualProductPicker, which previously duplicated
 * this logic locally. Every category produces a group even if it has zero
 * matching products; callers that don't want empty tabs (e.g.
 * ManualProductPicker) should filter the result themselves.
 */
export function groupProductsByCategory<T extends { category_id: string | null }>(
  products: T[],
  categories: Category[],
): CategoryGroup<T>[] {
  const sortedCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  const groups = sortedCategories.map((category) => ({
    id: category.id,
    label: category.name,
    color: category.color,
    icon: category.icon,
    products: products.filter((product) => product.category_id === category.id),
  }));

  const uncategorized = products.filter((product) => product.category_id === null);
  if (uncategorized.length > 0) {
    groups.push({
      id: OTHER_CATEGORY_ID,
      label: OTHER_CATEGORY_LABEL,
      color: OTHER_CATEGORY_COLOR,
      icon: OTHER_CATEGORY_ICON,
      products: uncategorized,
    });
  }

  return groups;
}

/**
 * Derives the currently-visible product list for the category tab bars in
 * CategoryProductList and ManualProductPicker. A non-empty search overrides
 * the active tab and matches across all products; otherwise the "All"
 * sentinel shows everything and a real category id shows only that group's
 * products.
 */
export function resolveVisibleProducts<T extends { category_id: string | null; name: string }>(params: {
  products: T[];
  groups: CategoryGroup<T>[];
  activeId: string;
  search: string;
}): T[] {
  const { products, groups, activeId, search } = params;
  const trimmed = search.trim().toLowerCase();
  if (trimmed.length > 0) {
    return products.filter((p) => p.name.toLowerCase().includes(trimmed));
  }
  if (activeId === ALL_CATEGORY_ID) {
    return products;
  }
  return groups.find((g) => g.id === activeId)?.products ?? [];
}
