"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { usePOSContext } from "@/context/POSContext";
import { useOfflineContext } from "@/context/OfflineContext";
import { createClient } from "@/lib/supabase/client";
import { listProductsWithCategory } from "@/services/products.service";
import { listCategories } from "@/services/categories.service";
import { getCachedCatalog } from "@/lib/offline/productCache";
import { setCachedCategories, setCachedProducts } from "@/lib/offline/db";
import type { Category, ProductWithCategory } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CameraBarcodeScanner } from "@/components/features/shared/CameraBarcodeScanner";
import { ManualProductPicker } from "@/components/features/pos/ManualProductPicker";
import { cn } from "@/lib/utils";

type Mode = "barcode" | "manual";

/**
 * Dual-mode barcode entry: a physical HID scanner fires keystrokes globally
 * (captured by useBarcodeScanner), while this input also accepts manual
 * typing for damaged/unreadable barcodes, or camera-based optical scanning.
 * Autofocused and refocused after every scan so the cashier never has to
 * click back into it.
 *
 * A separate "manual" mode lets the cashier pick category → product →
 * quantity instead of scanning, for items without a readable barcode.
 */
export function BarcodeScanner() {
  const { scanBarcode, isScanning, scanError, addProductToCart } = usePOSContext();
  const { isOnline } = useOfflineContext();
  const [manualValue, setManualValue] = useState("");
  const [mode, setMode] = useState<Mode>("barcode");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // The HID scanner listener stays enabled regardless of mode: it only
  // reacts to fast keystroke bursts outside of typing fields, so a stray
  // physical scan while in manual mode is harmless (and re-enabling it
  // automatically when switching back to barcode mode needs no extra code).
  useBarcodeScanner({
    onScan: (barcode) => {
      void scanBarcode(barcode);
      inputRef.current?.focus();
    },
  });

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = manualValue.trim();
    if (!trimmed) return;
    void scanBarcode(trimmed);
    setManualValue("");
  }

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
          onClick={() => setMode("barcode")}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
            mode === "barcode"
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-gray-200 bg-white text-gray-600",
          )}
        >
          باركود
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
            mode === "manual"
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-gray-200 bg-white text-gray-600",
          )}
        >
          يدوي
        </button>
      </div>

      {mode === "barcode" ? (
        <>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              autoFocus={mode === "barcode"}
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder="امسح الباركود أو أدخله يدوياً..."
              className="flex-1 text-lg"
              aria-label="باركود المنتج"
            />
            <Button
              type="button"
              size="lg"
              variant="secondary"
              onClick={() => setIsCameraOpen(true)}
              aria-label="مسح بالكاميرا"
            >
              📷
            </Button>
            <Button type="submit" size="lg" disabled={isScanning}>
              {isScanning ? "..." : "إضافة"}
            </Button>
          </form>
          {scanError ? (
            <div className="absolute mt-14 rounded-lg bg-red-100 px-3 py-1 text-sm text-red-700">{scanError}</div>
          ) : null}
          <CameraBarcodeScanner open={isCameraOpen} onClose={() => setIsCameraOpen(false)} onDetected={handleDetected} />
        </>
      ) : (
        <ManualProductPicker products={products} categories={categories} onAdd={handleManualAdd} />
      )}
    </div>
  );
}
