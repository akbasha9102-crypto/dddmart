"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { decrementStock, incrementStock, resolveBarcode } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { useCart } from "@/hooks/useCart";
import { findCartItemByBarcode, productToCartItem, productUnitToCartItem } from "@/types/pos";
import type { CompletedSale } from "@/types/pos";
import type { Product } from "@/types/product";
import type { ProductUnit } from "@/types/product";
import { toBaseUnits } from "@/lib/units";

interface UsePOSOptions {
  cashierId: string | null;
}

export function usePOS({ cashierId }: UsePOSOptions) {
  const cart = useCart();
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<CompletedSale | null>(null);

  const addProductToCart = useCallback(
    async (product: Product, quantity: number, unit?: ProductUnit) => {
      setScanError(null);
      const supabase = createClient();
      const baseUnits = toBaseUnits(quantity, unit?.conversion_factor);
      const updated = await decrementStock(supabase, product.id, baseUnits);
      if (!updated) {
        setScanError(`الكمية المتوفرة من ${product.name} غير كافية`);
        return;
      }
      cart.addItem(unit ? productUnitToCartItem(updated, unit, quantity) : productToCartItem(updated, quantity));
    },
    [cart],
  );

  const scanBarcode = useCallback(
    async (barcode: string) => {
      setScanError(null);
      setIsScanning(true);
      try {
        const supabase = createClient();
        const resolved = await resolveBarcode(supabase, barcode);

        if (!resolved) {
          setScanError(`لم يتم العثور على منتج بالباركود: ${barcode}`);
          return;
        }

        const { product } = resolved;
        const unit = resolved.kind === "unit" ? resolved.unit : undefined;
        const requiredBaseUnits = toBaseUnits(1, unit?.conversion_factor);

        if (product.quantity < requiredBaseUnits) {
          setScanError(`${product.name} غير متوفر في المخزون`);
          return;
        }

        await addProductToCart(product, 1, unit);
      } catch (error) {
        setScanError(error instanceof Error ? error.message : "حدث خطأ أثناء قراءة الباركود");
      } finally {
        setIsScanning(false);
      }
    },
    [addProductToCart],
  );

  const updateQuantity = useCallback(
    async (barcode: string, quantity: number) => {
      const item = findCartItemByBarcode(cart.items, barcode);
      if (!item) return;
      const delta = quantity - item.quantity;
      const baseDelta = toBaseUnits(delta, item.unitConversionFactor);
      const supabase = createClient();
      if (baseDelta < 0) {
        await incrementStock(supabase, item.productId, -baseDelta);
      } else if (baseDelta > 0) {
        const updated = await decrementStock(supabase, item.productId, baseDelta);
        if (!updated) {
          setScanError(`الكمية المتوفرة من ${item.name} غير كافية`);
          return;
        }
      }
      cart.updateQuantity(barcode, quantity);
    },
    [cart],
  );

  const removeItem = useCallback(
    async (barcode: string) => {
      const item = findCartItemByBarcode(cart.items, barcode);
      if (!item) return;
      const supabase = createClient();
      await incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor));
      cart.removeItem(barcode);
    },
    [cart],
  );

  const clear = useCallback(async () => {
    const supabase = createClient();
    await Promise.all(
      cart.items.map((item) => incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor))),
    );
    cart.clear();
  }, [cart]);

  const checkout = useCallback(
    async (paidAmount: number): Promise<CompletedSale> => {
      setIsCheckingOut(true);
      try {
        const supabase = createClient();
        const result = await createSale(supabase, {
          items: cart.items,
          discountAmount: cart.discountAmount,
          paidAmount,
          cashierId,
        });
        setLastReceipt(result);
        cart.clear();
        return result;
      } finally {
        setIsCheckingOut(false);
      }
    },
    [cart, cashierId],
  );

  const dismissReceipt = useCallback(() => setLastReceipt(null), []);

  return {
    items: cart.items,
    totals: cart.totals,
    discountAmount: cart.discountAmount,
    setDiscountAmount: cart.setDiscountAmount,
    addProductToCart,
    updateQuantity,
    removeItem,
    clear,
    isScanning,
    scanError,
    scanBarcode,
    checkout,
    isCheckingOut,
    lastReceipt,
    dismissReceipt,
  };
}

export type UsePOSReturn = ReturnType<typeof usePOS>;
