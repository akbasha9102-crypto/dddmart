import { describe, expect, it } from "vitest";
import type { Category } from "@/types/product";
import {
  ALL_CATEGORY_ID,
  OTHER_CATEGORY_ID,
  OTHER_CATEGORY_LABEL,
  groupProductsByCategory,
  resolveVisibleProducts,
} from "@/lib/categoryGroups";

interface TestProduct {
  id: string;
  category_id: string | null;
  name: string;
}

function makeCategory(overrides: Partial<Category>): Category {
  return {
    id: "cat-1",
    name: "خضروات",
    sort_order: 0,
    is_active: true,
    color: "#16a34a",
    icon: "leaf",
    store_id: "store-1",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const categories: Category[] = [
  makeCategory({ id: "cat-1", name: "خضروات", sort_order: 0 }),
  makeCategory({ id: "cat-2", name: "مشروبات", sort_order: 1 }),
];

const products: TestProduct[] = [
  { id: "p1", category_id: "cat-1", name: "طماطم" },
  { id: "p2", category_id: "cat-1", name: "خيار" },
  { id: "p3", category_id: "cat-2", name: "عصير برتقال" },
  { id: "p4", category_id: null, name: "منتج بدون قسم" },
];

describe("groupProductsByCategory", () => {
  it("groups products under their matching category, sorted by sort_order", () => {
    const groups = groupProductsByCategory(products, categories);
    expect(groups.map((g) => g.id)).toEqual(["cat-1", "cat-2", OTHER_CATEGORY_ID]);
    expect(groups[0]?.products.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(groups[1]?.products.map((p) => p.id)).toEqual(["p3"]);
  });

  it("appends an OTHER_CATEGORY group for uncategorized products", () => {
    const groups = groupProductsByCategory(products, categories);
    const other = groups.find((g) => g.id === OTHER_CATEGORY_ID);
    expect(other).toBeDefined();
    expect(other?.label).toBe(OTHER_CATEGORY_LABEL);
    expect(other?.products.map((p) => p.id)).toEqual(["p4"]);
  });

  it("omits the OTHER_CATEGORY group when there are no uncategorized products", () => {
    const categorized = products.filter((p) => p.category_id !== null);
    const groups = groupProductsByCategory(categorized, categories);
    expect(groups.find((g) => g.id === OTHER_CATEGORY_ID)).toBeUndefined();
  });

  it("still produces a group for a category with zero matching products", () => {
    const groups = groupProductsByCategory([], categories);
    expect(groups.map((g) => g.id)).toEqual(["cat-1", "cat-2"]);
    expect(groups[0]?.products).toEqual([]);
    expect(groups[1]?.products).toEqual([]);
  });
});

describe("resolveVisibleProducts", () => {
  const groups = groupProductsByCategory(products, categories);

  it("returns the full products array when activeId is ALL_CATEGORY_ID and search is empty", () => {
    const result = resolveVisibleProducts({ products, groups, activeId: ALL_CATEGORY_ID, search: "" });
    expect(result).toEqual(products);
  });

  it("returns only the matching group's products for a real category id with empty search", () => {
    const result = resolveVisibleProducts({ products, groups, activeId: "cat-2", search: "" });
    expect(result.map((p) => p.id)).toEqual(["p3"]);
  });

  it("returns case-insensitive substring matches across all products when searching, regardless of a real activeId", () => {
    const result = resolveVisibleProducts({ products, groups, activeId: "cat-1", search: "عصير" });
    expect(result.map((p) => p.id)).toEqual(["p3"]);
  });

  it("returns case-insensitive substring matches across all products when searching, regardless of ALL_CATEGORY_ID activeId", () => {
    const result = resolveVisibleProducts({ products, groups, activeId: ALL_CATEGORY_ID, search: "طماطم" });
    expect(result.map((p) => p.id)).toEqual(["p1"]);
  });

  it("reverts to the active category's products when search is cleared back to empty", () => {
    const withSearch = resolveVisibleProducts({ products, groups, activeId: "cat-1", search: "عصير" });
    expect(withSearch.map((p) => p.id)).toEqual(["p3"]);

    const cleared = resolveVisibleProducts({ products, groups, activeId: "cat-1", search: "" });
    expect(cleared.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("returns an empty array when no products match the search", () => {
    const result = resolveVisibleProducts({ products, groups, activeId: ALL_CATEGORY_ID, search: "لا يوجد شيء بهذا الاسم" });
    expect(result).toEqual([]);
  });

  it("returns an empty array for an unknown activeId with empty search", () => {
    const result = resolveVisibleProducts({ products, groups, activeId: "unknown-id", search: "" });
    expect(result).toEqual([]);
  });
});
