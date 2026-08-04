"use client";

import { useMemo, useState } from "react";
import type { Category, ProductWithCategory } from "@/types/product";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface ManualProductPickerProps {
  products: ProductWithCategory[];
  categories: Category[];
  onAdd: (product: ProductWithCategory, quantity: number) => void;
}

const OTHER_CATEGORY_ID = "__other__";
const OTHER_CATEGORY_LABEL = "أخرى";

/**
 * Manual entry mode: cashier picks a category, then a product, then a
 * quantity. Visually mirrors CategoryProductList's pill-tab pattern, but
 * rows are selectable (with a quantity stepper) instead of read-only.
 */
export function ManualProductPicker({ products, categories, onAdd }: ManualProductPickerProps) {
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

  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null);
  const [quantity, setQuantity] = useState(1);

  function selectProduct(product: ProductWithCategory) {
    if (product.quantity <= 0) return;
    setSelectedProduct(product);
    setQuantity(1);
  }

  function confirmAdd() {
    if (!selectedProduct) return;
    onAdd(selectedProduct, quantity);
    setSelectedProduct(null);
    setQuantity(1);
  }

  if (products.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا توجد منتجات بعد</p>;
  }

  return (
    <div className="flex max-h-64 flex-col gap-3">
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

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3">
        {activeGroup?.products.map((product) => (
          <button
            key={product.id}
            type="button"
            disabled={product.quantity <= 0}
            onClick={() => selectProduct(product)}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-right transition-colors",
              product.quantity <= 0
                ? "cursor-not-allowed bg-gray-50 opacity-60"
                : selectedProduct?.id === product.id
                  ? "bg-brand-50 ring-2 ring-brand-500"
                  : "bg-gray-50 hover:bg-gray-100",
            )}
          >
            <span className="font-medium text-gray-900">{product.name}</span>
            {product.quantity <= 0 ? (
              <span className="text-sm font-semibold text-red-600">غير متوفر</span>
            ) : (
              <span className="text-sm text-gray-500">
                {formatCurrency(product.sale_price)} · متوفر {product.quantity}
              </span>
            )}
          </button>
        ))}
      </div>

      {selectedProduct ? (
        <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
          <span className="flex-1 truncate font-medium text-gray-900">{selectedProduct.name}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-8 w-8 rounded-md bg-white text-lg font-bold hover:bg-gray-100"
              aria-label="إنقاص الكمية"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(selectedProduct.quantity, q + 1))}
              className="h-8 w-8 rounded-md bg-white text-lg font-bold hover:bg-gray-100"
              aria-label="زيادة الكمية"
            >
              +
            </button>
          </div>
          <Button size="sm" onClick={confirmAdd}>
            ➕ إضافة
          </Button>
        </div>
      ) : null}
    </div>
  );
}
