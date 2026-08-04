"use client";

import { useMemo, useState } from "react";
import type { Category, ProductWithCategory } from "@/types/product";
import { isLowStock } from "@/types/product";
import { cn } from "@/lib/utils";

interface CategoryProductListProps {
  products: ProductWithCategory[];
  categories: Category[];
}

const OTHER_CATEGORY_ID = "__other__";
const OTHER_CATEGORY_LABEL = "أخرى";

/** Mobile-first grouped product list — horizontal category tabs + active panel. */
export function CategoryProductList({ products, categories }: CategoryProductListProps) {
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  );

  const groups = useMemo(() => {
    const withProducts = sortedCategories
      .map((category) => ({
        id: category.id,
        label: category.name,
        products: products.filter((product) => product.category_id === category.id),
      }))
      .filter((group) => group.products.length > 0);

    const uncategorized = products.filter((product) => product.category_id === null);
    if (uncategorized.length > 0) {
      withProducts.push({ id: OTHER_CATEGORY_ID, label: OTHER_CATEGORY_LABEL, products: uncategorized });
    }
    return withProducts;
  }, [sortedCategories, products]);

  const [activeId, setActiveId] = useState<string | null>(groups[0]?.id ?? null);
  const activeGroup = groups.find((group) => group.id === activeId) ?? groups[0] ?? null;

  if (products.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا توجد منتجات بعد — أضف أول منتج</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => setActiveId(group.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              activeGroup?.id === group.id
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-gray-200 bg-white text-gray-600",
            )}
          >
            <span>{group.label}</span>
            <span className={cn("text-xs", activeGroup?.id === group.id ? "text-brand-100" : "text-gray-400")}>
              {group.products.length}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3">
        {activeGroup?.products.map((product) => <ProductRow key={product.id} product={product} />)}
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: ProductWithCategory }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
      <span className="font-medium text-gray-900">{product.name}</span>
      <span className={cn("font-semibold", isLowStock(product) && "text-red-600")}>
        {product.quantity}
        {isLowStock(product) ? " ⚠" : ""}
      </span>
    </div>
  );
}
