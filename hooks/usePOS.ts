"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { decrementStock, getProductByBarcode, incrementStock } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { useCart } from "@/hooks/useCart";
import { findCartItemByBarcode, productToCartItem } from "@/types/pos";
import type { CompletedSale } from "@/types/pos";
import type { Product } from "@/types/product";

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
    async (product: Product, quantity: number) => {
      setScanError(null);
      const supabase = createClient();
      const updated = await decrementStock(supabase, product.id, quantity);
      if (!updated) {
        setScanError(`الكمية المتوفرة من ${product.name} غير كافية`);
        return;
      }
      cart.addItem(productToCartItem(updated, quantity));
    },
    [cart],
  );

  const scanBarcode = useCallback(
    async (barcode: string) => {
      setScanError(null);
      setIsScanning(true);
      try {
        const supabase = createClient();
        const product = await getProductByBarcode(supabase, barcode);

        if (!product) {
          setScanError(`لم يتم العثور على منتج بالباركود: ${barcode}`);
          return;
        }

        if (product.quantity <= 0) {
          setScanError(`${product.name} غير متوفر في المخزون`);
          return;
        }

        await addProductToCart(product, 1);
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
      const supabase = createClient();
      if (delta < 0) {
        await incrementStock(supabase, item.productId, -delta);
      } else if (delta > 0) {
        const updated = await decrementStock(supabase, item.productId, delta);
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
      await incrementStock(supabase, item.productId, item.quantity);
      cart.removeItem(barcode);
    },
    [cart],
  );

  const clear = useCallback(async () => {
    const supabase = createClient();
    await Promise.all(cart.items.map((item) => incrementStock(supabase, item.productId, item.quantity)));
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
