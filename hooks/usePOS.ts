"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { playScanBeep, playSuccessChime } from "@/lib/audio/posSounds";
import { decrementStock, incrementStock, resolveBarcode } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { holdSale, resumeHeldSale } from "@/services/heldSales.service";
import { useCart } from "@/hooks/useCart";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { findCartItemByBarcode, productToCartItem, productUnitToCartItem, calculateTotals } from "@/types/pos";
import type { CompletedSale } from "@/types/pos";
import type { Product } from "@/types/product";
import type { ProductUnit } from "@/types/product";
import type { PaymentMethod } from "@/types/database.types";
import { toBaseUnits } from "@/lib/units";
import { generateInvoiceNumber } from "@/lib/utils";
import { addPendingSale } from "@/lib/offline/outbox";
import { applyLocalStockDelta, getCachedCatalog, getCachedUnitsList, resolveBarcodeOffline } from "@/lib/offline/productCache";

interface UsePOSOptions {
  cashierId: string | null;
}

export function usePOS({ cashierId }: UsePOSOptions) {
  const cart = useCart();
  const { isOnline } = useOnlineStatus();
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<CompletedSale | null>(null);

  const addProductToCart = useCallback(
    async (product: Product, quantity: number, unit?: ProductUnit) => {
      setScanError(null);
      const baseUnits = toBaseUnits(quantity, unit?.conversion_factor);

      if (!isOnline) {
        const { products: catalog } = await getCachedCatalog();
        const cachedProduct = catalog.find((item) => item.id === product.id);
        const currentQuantity = cachedProduct?.quantity ?? product.quantity;
        if (currentQuantity - baseUnits < 0) {
          setScanError(`الكمية المتوفرة من ${product.name} غير كافية`);
          return;
        }
        const updated = await applyLocalStockDelta(product.id, -baseUnits);
        if (!updated) {
          setScanError(`الكمية المتوفرة من ${product.name} غير كافية`);
          return;
        }
        cart.addItem(unit ? productUnitToCartItem(updated, unit, quantity) : productToCartItem(updated, quantity));
        playScanBeep();
        return;
      }

      const supabase = createClient();
      const updated = await decrementStock(supabase, product.id, baseUnits);
      if (!updated) {
        setScanError(`الكمية المتوفرة من ${product.name} غير كافية`);
        return;
      }
      cart.addItem(unit ? productUnitToCartItem(updated, unit, quantity) : productToCartItem(updated, quantity));
      playScanBeep();
    },
    [cart, isOnline],
  );

  const scanBarcode = useCallback(
    async (barcode: string) => {
      setScanError(null);
      setIsScanning(true);
      try {
        if (!isOnline) {
          const { products: catalog } = await getCachedCatalog();
          const units = await getCachedUnitsList();
          const resolved = resolveBarcodeOffline(barcode, catalog, units);

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
          return;
        }

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
    [addProductToCart, isOnline],
  );

  const updateQuantity = useCallback(
    async (barcode: string, quantity: number) => {
      const item = findCartItemByBarcode(cart.items, barcode);
      if (!item) return;
      const delta = quantity - item.quantity;
      const baseDelta = toBaseUnits(delta, item.unitConversionFactor);

      if (!isOnline) {
        if (baseDelta !== 0) {
          const updated = await applyLocalStockDelta(item.productId, -baseDelta);
          if (baseDelta > 0 && !updated) {
            setScanError(`الكمية المتوفرة من ${item.name} غير كافية`);
            return;
          }
        }
        cart.updateQuantity(barcode, quantity);
        return;
      }

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
    [cart, isOnline],
  );

  const removeItem = useCallback(
    async (barcode: string) => {
      const item = findCartItemByBarcode(cart.items, barcode);
      if (!item) return;

      if (!isOnline) {
        await applyLocalStockDelta(item.productId, toBaseUnits(item.quantity, item.unitConversionFactor));
        cart.removeItem(barcode);
        return;
      }

      const supabase = createClient();
      await incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor));
      cart.removeItem(barcode);
    },
    [cart, isOnline],
  );

  const clear = useCallback(async () => {
    if (!isOnline) {
      await Promise.all(
        cart.items.map((item) =>
          applyLocalStockDelta(item.productId, toBaseUnits(item.quantity, item.unitConversionFactor)),
        ),
      );
      cart.clear();
      return;
    }

    const supabase = createClient();
    await Promise.all(
      cart.items.map((item) => incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor))),
    );
    cart.clear();
  }, [cart, isOnline]);

  const checkout = useCallback(
    async (options: {
      paidAmount: number;
      paymentMethod?: PaymentMethod;
      customerId?: string | null;
      customerName?: string;
    }): Promise<CompletedSale> => {
      const { paidAmount, paymentMethod = "cash", customerId = null, customerName } = options;

      // A credit sale needs a live customer-balance read for the over-limit
      // warning, which is impossible offline (no customer cache like
      // lib/offline/productCache.ts) — simply disallowed while offline. The
      // POS UI also disables the "بالآجل" toggle when offline.
      if (!isOnline && paymentMethod === "credit") {
        throw new Error("البيع بالآجل غير متاح في وضع عدم الاتصال");
      }

      setIsCheckingOut(true);
      try {
        if (!isOnline) {
          const localId = crypto.randomUUID();
          const invoiceNumber = generateInvoiceNumber();
          const payload = {
            items: cart.items,
            discountAmount: cart.discountAmount,
            paidAmount,
            cashierId,
            id: localId,
            invoiceNumber,
          };

          await addPendingSale({
            localId,
            status: "pending",
            createdAt: new Date().toISOString(),
            payload,
            invoiceNumber,
          });

          const { subtotal, discountAmount, totalAmount } = calculateTotals(cart.items, cart.discountAmount);
          const changeAmount = Math.max(paidAmount - totalAmount, 0);
          const now = new Date().toISOString();

          const result: CompletedSale = {
            sale: {
              id: localId,
              invoice_number: invoiceNumber,
              cashier_id: cashierId,
              subtotal,
              discount_amount: discountAmount,
              total_amount: totalAmount,
              paid_amount: paidAmount,
              change_amount: changeAmount,
              // Always "cash" here — the guard above throws before this branch
              // is reached for a credit sale while offline.
              payment_method: "cash",
              customer_id: null,
              created_at: now,
            },
            items: cart.items.map((item, index) => ({
              id: `${localId}-${index}`,
              sale_id: localId,
              product_id: item.productId,
              product_name: item.name,
              barcode: item.barcode,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              total_price: item.unitPrice * item.quantity,
              unit_label: item.unitName ?? null,
              unit_conversion_factor: item.unitConversionFactor ?? 1,
              cost_price: item.costPrice,
            })),
            changeAmount,
          };

          setLastReceipt(result);
          playSuccessChime();
          cart.clear();
          return result;
        }

        const supabase = createClient();
        const result = await createSale(supabase, {
          items: cart.items,
          discountAmount: cart.discountAmount,
          paidAmount,
          cashierId,
          paymentMethod,
          customerId,
        });
        const resultWithCustomerName: CompletedSale = {
          ...result,
          customerName: paymentMethod === "credit" ? customerName : undefined,
        };
        setLastReceipt(resultWithCustomerName);
        playSuccessChime();
        cart.clear();
        return resultWithCustomerName;
      } finally {
        setIsCheckingOut(false);
      }
    },
    [cart, cashierId, isOnline],
  );

  const dismissReceipt = useCallback(() => setLastReceipt(null), []);

  const holdCurrentSale = useCallback(
    async (note: string | null) => {
      const supabase = createClient();
      await holdSale(supabase, {
        cashierId,
        items: cart.items,
        discountAmount: cart.discountAmount,
        note,
      });
      cart.clear();
    },
    [cart, cashierId],
  );

  const resumeSale = useCallback(
    async (id: string) => {
      if (cart.items.length > 0) {
        throw new Error("أفرغ أو علّق السلة الحالية أولاً قبل استرجاع فاتورة معلقة");
      }
      const supabase = createClient();
      const { items, discountAmount } = await resumeHeldSale(supabase, id);
      cart.loadItems(items, discountAmount);
    },
    [cart],
  );

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
    isOnline,
    holdCurrentSale,
    resumeSale,
  };
}

export type UsePOSReturn = ReturnType<typeof usePOS>;
