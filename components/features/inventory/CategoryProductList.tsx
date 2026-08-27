"use client";

import { useMemo, useState } from "react";
import { PackagePlus, PackageX, ClipboardCheck, Pencil, Trash2, LayoutGrid } from "lucide-react";
import type { Category, ProductWithCategory } from "@/types/product";
import { isLowStock } from "@/types/product";
import { cn } from "@/lib/utils";
import { ALL_CATEGORY_ID, ALL_CATEGORY_LABEL, groupProductsByCategory, resolveVisibleProducts } from "@/lib/categoryGroups";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useAuth } from "@/context/AuthContext";
import { isAdminRole } from "@/lib/employees/adminCheck";
import { ConfirmInline } from "@/components/ui/ConfirmInline";
import { Input } from "@/components/ui/Input";

interface CategoryProductListProps {
  products: ProductWithCategory[];
  categories: Category[];
  onEdit: (product: ProductWithCategory) => void;
  onDelete: (product: ProductWithCategory) => void;
  onReceiveStock: (product: ProductWithCategory) => void;
  onDamageStock: (product: ProductWithCategory) => void;
  onReconcileStock: (product: ProductWithCategory) => void;
}

/** Mobile-first grouped product list — horizontal category tabs + active panel. Primary product-management surface on mobile, so edit/delete live here too. */
export function CategoryProductList({
  products,
  categories,
  onEdit,
  onDelete,
  onReceiveStock,
  onDamageStock,
  onReconcileStock,
}: CategoryProductListProps) {
  const groups = useMemo(() => groupProductsByCategory(products, categories), [products, categories]);

  const [activeId, setActiveId] = useState<string>(ALL_CATEGORY_ID);
  const [search, setSearch] = useState("");
  const visibleProducts = resolveVisibleProducts({ products, groups, activeId, search });
  const isSearching = search.trim().length > 0;

  if (groups.length === 0) {
    return <p className="p-4 text-center text-gray-400">لا توجد منتجات بعد — أضف أول منتج</p>;
  }

  return (
    <div className="flex flex-col gap-2">
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
            "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
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
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
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

      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2.5">
        {visibleProducts.length === 0 ? (
          <p className="p-4 text-center text-gray-400">
            {isSearching ? "لا توجد نتائج بحث" : "لا توجد منتجات بهذا القسم"}
          </p>
        ) : (
          visibleProducts.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              onEdit={onEdit}
              onDelete={onDelete}
              onReceiveStock={onReceiveStock}
              onDamageStock={onDamageStock}
              onReconcileStock={onReconcileStock}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ProductRow({
  product,
  onEdit,
  onDelete,
  onReceiveStock,
  onDamageStock,
  onReconcileStock,
}: {
  product: ProductWithCategory;
  onEdit: (product: ProductWithCategory) => void;
  onDelete: (product: ProductWithCategory) => void;
  onReceiveStock: (product: ProductWithCategory) => void;
  onDamageStock: (product: ProductWithCategory) => void;
  onReconcileStock: (product: ProductWithCategory) => void;
}) {
  const { role } = useAuth();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <ConfirmInline
        message={`تأكيد حذف "${product.name}"؟`}
        confirmLabel="حذف"
        onConfirm={() => {
          setConfirming(false);
          onDelete(product);
        }}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
      <span className="flex-1 truncate font-medium text-gray-900">{product.name}</span>
      <span className={cn("font-semibold", isLowStock(product) && "text-red-600")}>
        {product.quantity}
        {isLowStock(product) ? " ⚠" : ""}
      </span>
      <div className="flex items-center gap-1">
        {isAdminRole(role) ? (
          <button
            type="button"
            onClick={() => onReceiveStock(product)}
            className="rounded-md p-1.5 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700"
            aria-label="استلام مخزون"
          >
            <PackagePlus className="h-4 w-4" />
          </button>
        ) : null}
        {isAdminRole(role) ? (
          <button
            type="button"
            onClick={() => onDamageStock(product)}
            className="rounded-md p-1.5 text-gray-500 hover:bg-orange-100 hover:text-orange-700"
            aria-label="تسجيل تلف"
          >
            <PackageX className="h-4 w-4" />
          </button>
        ) : null}
        {isAdminRole(role) ? (
          <button
            type="button"
            onClick={() => onReconcileStock(product)}
            className="rounded-md p-1.5 text-gray-500 hover:bg-indigo-100 hover:text-indigo-700"
            aria-label="تسوية المخزون"
          >
            <ClipboardCheck className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onEdit(product)}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-200 hover:text-brand-700"
          aria-label="تعديل"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md p-1.5 text-gray-500 hover:bg-red-100 hover:text-red-600"
          aria-label="حذف"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
