"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { searchProducts } from "@/services/products.service";
import { linkSupplierProduct, unlinkSupplierProduct } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import type { Product } from "@/types/product";
import type { SupplierProductWithDetails } from "@/types/supplier";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

interface SupplierProductPickerProps {
  supplierId: string;
  products: SupplierProductWithDetails[];
  onChanged: () => void;
}

/** Linked-products section on the supplier detail screen: list of currently-linked products (with per-supplier cost), "+ ربط منتج" opens a search-and-pick modal. */
export function SupplierProductPicker({ supplierId, products, onChanged }: SupplierProductPickerProps) {
  const { storeId } = useAuth();

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pickedProduct, setPickedProduct] = useState<Product | null>(null);
  const [costPrice, setCostPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const linkedProductIds = new Set(products.map((row) => row.product_id));

  function openPicker() {
    setQuery("");
    setResults([]);
    setPickedProduct(null);
    setCostPrice("");
    setError(null);
    setIsPickerOpen(true);
  }

  async function handleSearch(term: string) {
    setQuery(term);
    setPickedProduct(null);
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const supabase = createClient();
      const found = await searchProducts(supabase, term.trim());
      setResults(found);
    } finally {
      setIsSearching(false);
    }
  }

  function pickProduct(product: Product) {
    setPickedProduct(product);
    setCostPrice(String(product.cost_price));
  }

  async function handleLink(event: FormEvent) {
    event.preventDefault();
    if (!pickedProduct) return;
    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      await linkSupplierProduct(
        supabase,
        { supplierId, productId: pickedProduct.id, costPrice: Number(costPrice) || null },
        storeId,
      );
      setIsPickerOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر ربط المنتج");
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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">المنتجات المرتبطة</h3>
        <Button size="sm" variant="secondary" onClick={openPicker}>
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

      <Modal open={isPickerOpen} onClose={() => setIsPickerOpen(false)} title="ربط منتج بالمورد">
        <div className="flex flex-col gap-4">
          <Input
            type="text"
            placeholder="ابحث باسم المنتج"
            value={query}
            onChange={(event) => void handleSearch(event.target.value)}
            autoFocus
          />

          {isSearching ? (
            <p className="p-4 text-center text-sm text-gray-400">جارٍ البحث...</p>
          ) : results.length > 0 ? (
            <div className="flex max-h-48 flex-col divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100">
              {results.map((product) => {
                const alreadyLinked = linkedProductIds.has(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={alreadyLinked}
                    onClick={() => pickProduct(product)}
                    className="flex items-center justify-between gap-3 p-3 text-right hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="text-sm text-gray-900">{product.name}</span>
                    {alreadyLinked ? <span className="text-xs text-gray-400">مرتبط مسبقاً</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {pickedProduct ? (
            <form onSubmit={handleLink} className="flex flex-col gap-4 border-t border-gray-100 pt-4">
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
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" size="lg" disabled={isSaving}>
                {isSaving ? "جارٍ الحفظ..." : "ربط المنتج"}
              </Button>
            </form>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
