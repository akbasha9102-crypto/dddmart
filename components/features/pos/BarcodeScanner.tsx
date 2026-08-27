"use client";

import { useCallback, useEffect, useState } from "react";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { usePOSContext } from "@/context/POSContext";
import { useOfflineContext } from "@/context/OfflineContext";
import { createClient } from "@/lib/supabase/client";
import { listProductsWithCategory } from "@/services/products.service";
import { listCategories } from "@/services/categories.service";
import { getCachedCatalog } from "@/lib/offline/productCache";
import { setCachedCategories, setCachedProducts } from "@/lib/offline/db";
import type { Category, ProductWithCategory } from "@/types/product";
import { CameraBarcodeScanner } from "@/components/features/shared/CameraBarcodeScanner";
import { ManualProductPicker } from "@/components/features/pos/ManualProductPicker";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

/**
 * Barcode entry: a physical HID scanner fires keystrokes globally (captured
 * by useBarcodeScanner) regardless of which UI mode is shown below. Visibly,
 * the cashier has two explicit entry methods: an optical camera scan
 * (one-shot action, opens a modal) or a manual category → product →
 * quantity picker (modal) for items without a readable barcode.
 */
export function BarcodeScanner() {
  const { scanBarcode, scanError, addProductToCart } = usePOSContext();
  const { isOnline } = useOfflineContext();
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // The HID scanner listener stays enabled regardless of whether the manual
  // picker modal is open: it only reacts to fast keystroke bursts outside of
  // typing fields, so a stray physical scan while the modal is open is
  // harmless.
  const handleHidScan = useCallback(
    (barcode: string) => {
      void scanBarcode(barcode);
    },
    [scanBarcode],
  );

  useBarcodeScanner({ onScan: handleHidScan });

  useEffect(() => {
    async function loadData() {
      if (!isOnline) {
        const cached = await getCachedCatalog();
        setProducts(cached.products);
        setCategories(cached.categories);
        return;
      }

      const supabase = createClient();
      const [productList, categoryList] = await Promise.all([
        listProductsWithCategory(supabase),
        listCategories(supabase),
      ]);
      setProducts(productList);
      setCategories(categoryList);
      // Keep IndexedDB warm for the next offline period.
      void setCachedProducts(productList);
      void setCachedCategories(categoryList);
    }
    void loadData();
  }, [isOnline]);

  const handleDetected = useCallback(
    (barcode: string) => {
      setIsCameraOpen(false);
      void scanBarcode(barcode);
    },
    [scanBarcode],
  );

  function handleManualAdd(product: ProductWithCategory, quantity: number) {
    void addProductToCart(product, quantity);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setIsCameraOpen(true)}
          className="rounded-full border border-brand-600 bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition-colors"
        >
          📷 مسح بالكاميرا
        </button>
        <button
          type="button"
          onClick={() => setIsManualOpen(true)}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
            isManualOpen
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-gray-200 bg-white text-gray-600",
          )}
        >
          يدوي
        </button>
      </div>

      {scanError ? (
        <div className="rounded-lg bg-red-100 px-3 py-1 text-sm text-red-700">{scanError}</div>
      ) : null}

      <Modal open={isManualOpen} onClose={() => setIsManualOpen(false)} title="إضافة يدوية">
        <ManualProductPicker
          products={products}
          categories={categories}
          open={isManualOpen}
          onAdd={handleManualAdd}
          onClose={() => setIsManualOpen(false)}
        />
      </Modal>

      <CameraBarcodeScanner open={isCameraOpen} onClose={() => setIsCameraOpen(false)} onDetected={handleDetected} />
    </div>
  );
}
