"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { playScanBeep, playSuccessChime } from "@/lib/audio/posSounds";
import { resolveBarcode } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { holdSale, resumeHeldSale } from "@/services/heldSales.service";
import { useCart } from "@/hooks/useCart";
import { productToCartItem, productUnitToCartItem, calculateTotals } from "@/types/pos";
import type { CompletedSale } from "@/types/pos";
import type { Product } from "@/types/product";
import type { ProductUnit } from "@/types/product";
import type { PaymentMethod } from "@/types/database.types";
import type { Shift } from "@/types/shifts";
import { toBaseUnits } from "@/lib/units";
import { generateInvoiceNumber } from "@/lib/utils";
import { addPendingHeldSale, addPendingSale, getPendingHeldSales, removePendingHeldSale } from "@/lib/offline/outbox";
import { getCachedCatalog, getCachedUnitsList, resolveBarcodeOffline } from "@/lib/offline/productCache";

interface UsePOSOptions {
  cashierId: string | null;
  storeId: string | null;
  shift: Shift | null;
  isOnline: boolean;
}

export function usePOS({ cashierId, storeId, shift, isOnline }: UsePOSOptions) {
  const cart = useCart();
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<CompletedSale | null>(null);

  const addProductToCart = useCallback(
    (product: Product, quantity: number, unit?: ProductUnit) => {
      setScanError(null);
      if (!shift) {
        setScanError("افتح وردية أولاً قبل البيع");
        return;
      }
      const baseUnits = toBaseUnits(quantity, unit?.conversion_factor);
      // Advisory only — last-known quantity, not a reservation. Authoritative
      // check-and-decrement happens server-side at checkout/hold time
      // (create_sale_atomic / hold_sale, migrations 42/43).
      if (product.quantity < baseUnits) {
        setScanError(`الكمية المتوفرة من ${product.name} غير كافية`);
        return;
      }
      cart.addItem(unit ? productUnitToCartItem(product, unit, quantity) : productToCartItem(product, quantity));
      playScanBeep();
    },
    [cart, shift],
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

          addProductToCart(product, 1, unit);
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

        addProductToCart(product, 1, unit);
      } catch (error) {
        setScanError(error instanceof Error ? error.message : "حدث خطأ أثناء قراءة الباركود");
      } finally {
        setIsScanning(false);
      }
    },
    [addProductToCart, isOnline],
  );

  /**
   * Cart quantity/removal/clear are now purely local, unreserved operations
   * — no DB/IndexedDB stock adjustment happens here at all. Stock is never
   * touched until the cart is actually committed (checkout -> create_sale_atomic,
   * or hold -> hold_sale), which atomically validates and decrements
   * server-side in one transaction — see migrations 42/43. This also means
   * there's nothing left to debounce/batch/flush here: every tap is just an
   * in-memory cart update.
   */
  const updateQuantity = useCallback(
    (barcode: string, quantity: number) => {
      cart.updateQuantity(barcode, quantity);
    },
    [cart],
  );

  const removeItem = useCallback(
    (barcode: string) => {
      cart.removeItem(barcode);
    },
    [cart],
  );

  const clear = useCallback(() => {
    cart.clear();
  }, [cart]);

  const checkout = useCallback(
    async (options: {
      paidAmount: number;
      paymentMethod?: PaymentMethod;
      customerId?: string | null;
      customerName?: string;
    }): Promise<CompletedSale> => {
      const { paidAmount, paymentMethod = "cash", customerId = null, customerName } = options;

      if (!shift) {
        throw new Error("افتح وردية أولاً قبل البيع");
      }

      // A credit sale needs a live customer-balance read for the over-limit
      // warning, which is impossible offline (no customer cache like
      // lib/offline/productCache.ts) — simply disallowed while offline. The
      // POS UI also disables the "بالآجل" toggle when offline.
      if (!isOnline && paymentMethod === "credit") {
        throw new Error("البيع بالآجل غير متاح في وضع عدم الاتصال");
      }

      if (!storeId) {
        throw new Error("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
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
            storeId,
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
              store_id: storeId,
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
              store_id: storeId,
            })),
            changeAmount,
          };

          setLastReceipt(result);
          playSuccessChime();
          cart.clear();
          return result;
        }

        const supabase = createClient();
        const result = await createSale(
          supabase,
          {
            items: cart.items,
            discountAmount: cart.discountAmount,
            paidAmount,
            cashierId,
            paymentMethod,
            customerId,
          },
          storeId,
        );
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
    [cart, cashierId, isOnline, storeId, shift],
  );

  const dismissReceipt = useCallback(() => setLastReceipt(null), []);

  const holdCurrentSale = useCallback(
    async (note: string | null) => {
      if (!shift) {
        throw new Error("افتح وردية أولاً قبل البيع");
      }

      if (!storeId) {
        throw new Error("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      }

      if (!isOnline) {
        await addPendingHeldSale({
          localId: crypto.randomUUID(),
          status: "pending",
          createdAt: new Date().toISOString(),
          cashierId,
          items: cart.items,
          discountAmount: cart.discountAmount,
          note,
          storeId,
        });
        cart.clear();
        return;
      }

      const supabase = createClient();
      await holdSale(
        supabase,
        {
          cashierId,
          items: cart.items,
          discountAmount: cart.discountAmount,
          note,
        },
        storeId,
      );
      cart.clear();
    },
    [cart, cashierId, isOnline, storeId, shift],
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

  /**
   * Resumes a held sale still sitting in the local offline outbox (never
   * synced to Supabase yet) — separate from resumeSale, which only handles
   * already-synced held_sales rows and stays online-only. Removes the entry
   * from the outbox once its items are back in the cart so it can't be
   * resumed twice or replayed by syncManager after the cashier already
   * pulled it back into the cart.
   */
  const resumePendingHeldSale = useCallback(
    async (localId: string) => {
      if (cart.items.length > 0) {
        throw new Error("أفرغ أو علّق السلة الحالية أولاً قبل استرجاع فاتورة معلقة");
      }
      const pending = await getPendingHeldSales();
      const sale = pending.find((s) => s.localId === localId);
      if (!sale) {
        throw new Error("تعذر العثور على الفاتورة المعلقة محلياً");
      }
      cart.loadItems(sale.items, sale.discountAmount);
      await removePendingHeldSale(localId);
    },
    [cart],
  );

  return useMemo(
    () => ({
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
      resumePendingHeldSale,
    }),
    [
      cart,
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
      resumePendingHeldSale,
    ],
  );
}

export type UsePOSReturn = ReturnType<typeof usePOS>;
