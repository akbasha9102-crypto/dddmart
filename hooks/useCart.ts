"use client";

import { useCallback, useMemo, useState } from "react";
import type { CartItem } from "@/types/pos";
import { calculateTotals, findCartItemByBarcode } from "@/types/pos";

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [discountAmount, setDiscountAmount] = useState(0);

  const addItem = useCallback((item: CartItem) => {
    setItems((prev) => {
      const existing = findCartItemByBarcode(prev, item.barcode);
      if (existing) {
        return prev.map((cartItem) =>
          cartItem.barcode === item.barcode
            ? { ...cartItem, quantity: cartItem.quantity + item.quantity }
            : cartItem,
        );
      }
      return [...prev, item];
    });
  }, []);

  const updateQuantity = useCallback((barcode: string, quantity: number) => {
    setItems((prev) =>
      quantity <= 0
        ? prev.filter((item) => item.barcode !== barcode)
        : prev.map((item) => (item.barcode === barcode ? { ...item, quantity } : item)),
    );
  }, []);

  const removeItem = useCallback((barcode: string) => {
    setItems((prev) => prev.filter((item) => item.barcode !== barcode));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setDiscountAmount(0);
  }, []);

  const totals = useMemo(() => calculateTotals(items, discountAmount), [items, discountAmount]);

  return {
    items,
    totals,
    discountAmount,
    setDiscountAmount,
    addItem,
    updateQuantity,
    removeItem,
    clear,
  };
}
