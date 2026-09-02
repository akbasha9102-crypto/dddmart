"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { LayoutGrid, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { listProductsWithCategory } from "@/services/products.service";
import { listCategories } from "@/services/categories.service";
import { linkSupplierProducts, unlinkSupplierProduct } from "@/services/suppliers.service";
import type { LinkSupplierProductInput } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import type { Category, ProductWithCategory } from "@/types/product";
import type { SupplierProductWithDetails } from "@/types/supplier";
import { cn, formatCurrency } from "@/lib/utils";
import { ALL_CATEGORY_ID, ALL_CATEGORY_LABEL, groupProductsByCategory, resolveVisibleProducts } from "@/lib/categoryGroups";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toast } from "@/components/ui/Toast";
import { BackButton } from "@/components/ui/BackButton";

interface SupplierProductPickerProps {
  supplierId: string;
  products: SupplierProductWithDetails[];
  onChanged: () => void;
}

/** Linked-products section on the supplier detail screen: list of currently-linked products (with per-supplier cost), "+ ربط منتج" switches to an inline search-and-stage view for linking several products in one batch. */
export function SupplierProductPicker({ supplierId, products, onChanged }: SupplierProductPickerProps) {
  const { storeId } = useAuth();

  const [mode, setMode] = useState<"list" | "add">("list");
  const [catalogProducts, setCatalogProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [activeId, setActiveId] = useState<string>(ALL_CATEGORY_ID);
  const [search, setSearch] = useState("");

  const groups = useMemo(
    () => groupProductsByCategory(catalogProducts, categories).filter((group) => group.products.length > 0),
    [catalogProducts, categories],
  );
  const visibleProducts = resolveVisibleProducts({ products: catalogProducts, groups, activeId, search });
  const isSearching = search.trim().length > 0;

  const [pickedProduct, setPickedProduct] = useState<ProductWithCategory | null>(null);
  const [costPrice, setCostPrice] = useState("");
  const [stagedItems, setStagedItems] = useState<{ product: ProductWithCategory; costPrice: string }[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const linkedProductIds = new Set(products.map((row) => row.product_id));
  const stagedProductIds = new Set(stagedItems.map((item) => item.product.id));

  async function openAddMode() {
    setSearch("");
    setActiveId(ALL_CATEGORY_ID);
    setPickedProduct(null);
    setCostPrice("");
    setStagedItems([]);
    setSuccessMessage(null);
    setError(null);
    setMode("add");

    setIsLoadingCatalog(true);
    try {
      const supabase = createClient();
      const [fetchedProducts, fetchedCategories] = await Promise.all([
        listProductsWithCategory(supabase),
        listCategories(supabase),
      ]);
      setCatalogProducts(fetchedProducts);
      setCategories(fetchedCategories);
    } finally {
      setIsLoadingCatalog(false);
    }
  }

  function closeAddMode() {
    setMode("list");
    setPickedProduct(null);
    setCostPrice("");
    setStagedItems([]);
    setError(null);
  }

  function pickProduct(product: ProductWithCategory) {
    setPickedProduct(product);
    setCostPrice(String(product.cost_price));
  }

  function stageProduct(event: FormEvent) {
    event.preventDefault();
    if (!pickedProduct) return;

    setStagedItems((items) => [...items, { product: pickedProduct, costPrice }]);
    setPickedProduct(null);
    setCostPrice("");
  }

  function updateStagedCostPrice(productId: string, value: string) {
    setStagedItems((items) =>
      items.map((item) => (item.product.id === productId ? { ...item, costPrice: value } : item)),
    );
  }

  function removeStagedItem(productId: string) {
    setStagedItems((items) => items.filter((item) => item.product.id !== productId));
  }

  async function handleLinkAll() {
    if (stagedItems.length === 0) return;
    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      const inputs: LinkSupplierProductInput[] = stagedItems.map((item) => ({
        supplierId,
        productId: item.product.id,
        costPrice: Number(item.costPrice) || null,
      }));
      await linkSupplierProducts(supabase, inputs, storeId);
      const count = stagedItems.length;
      setSuccessMessage(`تم ربط ${count} منتج`);
      setStagedItems([]);
      setMode("list");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر ربط المنتجات");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnlink(productId: string) {
    const supabase = createClient();
    await unlinkSupplierProduct(supabase, supplierId, productId);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2">
      {mode === "list" ? (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">المنتجات المرتبطة</h3>
            <Button size="sm" variant="secondary" onClick={() => void openAddMode()}>
              <Plus className="h-4 w-4" />
              ربط منتج
            </Button>
          </div>

          {products.length === 0 ? (
            <p className="p-6 text-center text-gray-400">لا توجد منتجات مرتبطة بهذا المورد بعد</p>
          ) : (
            <Card className="p-0">
              <div className="flex flex-col divide-y divide-gray-100">
                {products.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium text-gray-900">{row.product.name}</p>
                      <p className="text-xs text-gray-400">{row.product.barcode}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900">
                        {formatCurrency(row.cost_price ?? row.product.cost_price)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleUnlink(row.product_id)}
                        className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                        aria-label="إلغاء الربط"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <BackButton onClick={closeAddMode} aria-label="رجوع للمنتجات المرتبطة" className="mb-2" />
            <h3 className="text-sm font-semibold text-gray-700">ربط منتج بالمورد</h3>
          </div>

          <Input
            type="text"
            placeholder="ابحث باسم المنتج"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />

          {isLoadingCatalog ? (
            <p className="p-4 text-center text-sm text-gray-400">جارٍ التحميل...</p>
          ) : (
            <>
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
                    {catalogProducts.length}
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

              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-lg border border-gray-100 p-2">
                {visibleProducts.length === 0 ? (
                  <p className="p-4 text-center text-sm text-gray-400">
                    {isSearching ? "لا توجد نتائج بحث" : "لا توجد منتجات بعد"}
                  </p>
                ) : (
                  visibleProducts.map((product) => {
                    const alreadyLinked = linkedProductIds.has(product.id);
                    const alreadyStaged = stagedProductIds.has(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        disabled={alreadyLinked || alreadyStaged}
                        onClick={() => pickProduct(product)}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-lg p-3 text-right transition-colors",
                          alreadyLinked
                            ? "cursor-not-allowed bg-gray-50 opacity-50"
                            : alreadyStaged
                              ? "cursor-not-allowed bg-brand-50/60 opacity-60"
                              : pickedProduct?.id === product.id
                                ? "bg-brand-50 ring-2 ring-brand-500"
                                : "hover:bg-gray-50",
                        )}
                      >
                        <span className="text-sm text-gray-900">{product.name}</span>
                        {alreadyLinked ? (
                          <span className="text-xs text-gray-400">مرتبط مسبقاً</span>
                        ) : alreadyStaged ? (
                          <span className="text-xs text-gray-400">أُضيف للقائمة</span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {pickedProduct ? (
            <form onSubmit={stageProduct} className="flex flex-col gap-4 border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-700">
                المنتج المختار: <span className="font-semibold">{pickedProduct.name}</span>
              </p>
              <Input
                type="number"
                label="سعر الشراء من هذا المورد"
                min={0}
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
              />
              <Button type="submit" size="lg">
                إضافة إلى القائمة
              </Button>
            </form>
          ) : null}

          {stagedItems.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-gray-100 pt-4">
              <h4 className="text-sm font-semibold text-gray-700">المنتجات المضافة ({stagedItems.length})</h4>
              <Card className="p-0">
                <div className="flex flex-col divide-y divide-gray-100">
                  {stagedItems.map((item) => (
                    <div key={item.product.id} className="flex items-center justify-between gap-3 p-3">
                      <p className="truncate text-sm font-medium text-gray-900">{item.product.name}</p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          className="w-28"
                          value={item.costPrice}
                          onChange={(event) => updateStagedCostPrice(item.product.id, event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => removeStagedItem(item.product.id)}
                          className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                          aria-label="إزالة من القائمة"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <Button
            type="button"
            size="lg"
            disabled={stagedItems.length === 0 || isSaving}
            onClick={() => void handleLinkAll()}
          >
            {isSaving ? "جارٍ الحفظ..." : `ربط جميع المنتجات (${stagedItems.length})`}
          </Button>
        </div>
      )}

      {successMessage ? <Toast message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
    </div>
  );
}
