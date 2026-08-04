"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getProductByBarcode } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { useCart } from "@/hooks/useCart";
import { productToCartItem } from "@/types/pos";
import type { CompletedSale } from "@/types/pos";

interface UsePOSOptions {
  cashierId: string | null;
}

export function usePOS({ cashierId }: UsePOSOptions) {
  const cart = useCart();
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<CompletedSale | null>(null);

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

        cart.addItem(productToCartItem(product, 1));
      } catch (error) {
        setScanError(error instanceof Error ? error.message : "حدث خطأ أثناء قراءة الباركود");
      } finally {
        setIsScanning(false);
      }
    },
    [cart],
  );

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
    ...cart,
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
