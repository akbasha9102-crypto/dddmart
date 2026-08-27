"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { Category, ProductWithCategory } from "@/types/product";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ALL_CATEGORY_ID, ALL_CATEGORY_LABEL, groupProductsByCategory, resolveVisibleProducts } from "@/lib/categoryGroups";
import { getCategoryIcon } from "@/lib/categoryIcons";

interface ManualProductPickerProps {
  products: ProductWithCategory[];
  categories: Category[];
  open: boolean;
  onAdd: (product: ProductWithCategory, quantity: number) => void;
  onClose: () => void;
}

/**
 * Manual entry mode: cashier picks a category, then a product, then a
 * quantity. Visually mirrors CategoryProductList's pill-tab pattern, but
 * rows are selectable (with a quantity stepper) instead of read-only.
 */
export function ManualProductPicker({ products, categories, open, onAdd, onClose }: ManualProductPickerProps) {
  const groups = useMemo(
    () => groupProductsByCategory(products, categories).filter((group) => group.products.length > 0),
    [products, categories],
  );

  const [activeId, setActiveId] = useState<string>(ALL_CATEGORY_ID);
  const [search, setSearch] = useState("");
  const visibleProducts = resolveVisibleProducts({ products, groups, activeId, search });
  const isSearching = search.trim().length > 0;

  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (!open) return;
    setActiveId(ALL_CATEGORY_ID);
    setSearch("");
    setSelectedProduct(null);
    setQuantity(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    return (
      <div className="flex flex-col gap-3">
        <p className="p-6 text-center text-gray-400">لا توجد منتجات بعد</p>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            ✅ إغلاق
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-h-64 flex-col gap-3">
      <Input
        type="text"
        placeholder="ابحث باسم المنتج"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => setActiveId(ALL_CATEGORY_ID)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors",
            activeId === ALL_CATEGORY_ID
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-brand-200 bg-white text-gray-600 hover:bg-brand-50",
          )}
        >
          <LayoutGrid className="h-4 w-4" />
          <span>{ALL_CATEGORY_LABEL}</span>
          <span className={cn("text-xs", activeId === ALL_CATEGORY_ID ? "text-white/80" : "text-gray-400")}>
            {products.length}
          </span>
        </button>
        {groups.map((group) => {
          const isActive = activeId === group.id;
          const Icon = getCategoryIcon(group.icon);
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveId(group.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-brand-200 bg-white text-gray-600 hover:bg-brand-50",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{group.label}</span>
              <span className={cn("text-xs", isActive ? "text-white/80" : "text-gray-400")}>
                {group.products.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3">
        {visibleProducts.length === 0 ? (
          <p className="p-4 text-center text-gray-400">
            {isSearching ? "لا توجد نتائج بحث" : "لا توجد منتجات بعد"}
          </p>
        ) : (
          visibleProducts.map((product) => (
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
              <span className="flex-1 truncate font-medium text-gray-900">{product.name}</span>
              {product.quantity <= 0 ? (
                <span className="shrink-0 text-sm font-semibold text-red-600">غير متوفر</span>
              ) : (
                <span className="shrink-0 text-sm text-gray-500">
                  {formatCurrency(product.sale_price)} · متوفر {product.quantity}
                </span>
              )}
            </button>
          ))
        )}
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

      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          ✅ إغلاق
        </Button>
      </div>
    </div>
  );
}
