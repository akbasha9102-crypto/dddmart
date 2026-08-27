"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { addPendingHeldSale, addPendingSale, getPendingHeldSales, removePendingHeldSale } from "@/lib/offline/outbox";
import { applyLocalStockDelta, getCachedCatalog, getCachedUnitsList, resolveBarcodeOffline } from "@/lib/offline/productCache";

interface UsePOSOptions {
  cashierId: string | null;
  storeId: string | null;
}

export function usePOS({ cashierId, storeId }: UsePOSOptions) {
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

  /**
   * Pending quantity-change batches keyed by barcode. Each tap of the
   * cart's +/- button applies the visible quantity change immediately (see
   * updateQuantity below), then coalesces the actual stock-adjustment
   * network/IndexedDB call into a single request per short burst of taps,
   * so mashing "+" doesn't fire one Supabase round-trip per click. `baseline`
   * is the cart quantity from before the burst started; `netBaseDelta` is
   * the accumulated base-unit delta since that baseline.
   */
  const pendingQuantityRef = useRef<
    Map<
      string,
      {
        timer: ReturnType<typeof setTimeout>;
        baseline: number;
        netBaseDelta: number;
        productId: string;
        name: string;
      }
    >
  >(new Map());

  const updateQuantity = useCallback(
    (barcode: string, quantity: number) => {
      const item = findCartItemByBarcode(cart.items, barcode);
      if (!item) return;

      // Instant visual feedback on every tap — no debounce on the UI side.
      cart.updateQuantity(barcode, quantity);

      const pending = pendingQuantityRef.current.get(barcode);
      const baseline = pending?.baseline ?? item.quantity;
      const netBaseDelta = toBaseUnits(quantity - baseline, item.unitConversionFactor);

      if (pending) {
        clearTimeout(pending.timer);
      }

      const productId = item.productId;
      const name = item.name;

      const timer = setTimeout(() => {
        void (async () => {
          pendingQuantityRef.current.delete(barcode);

          if (netBaseDelta === 0) return;

          if (!isOnline) {
            const updated = await applyLocalStockDelta(productId, -netBaseDelta);
            if (netBaseDelta > 0 && !updated) {
              cart.updateQuantity(barcode, baseline);
              setScanError(`الكمية المتوفرة من ${name} غير كافية`);
            }
            return;
          }

          const supabase = createClient();
          if (netBaseDelta < 0) {
            await incrementStock(supabase, productId, -netBaseDelta);
          } else {
            const updated = await decrementStock(supabase, productId, netBaseDelta);
            if (!updated) {
              cart.updateQuantity(barcode, baseline);
              setScanError(`الكمية المتوفرة من ${name} غير كافية`);
            }
          }
        })();
      }, 200);

      pendingQuantityRef.current.set(barcode, {
        timer,
        baseline,
        netBaseDelta,
        productId,
        name,
      });
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
    [cart, cashierId, isOnline, storeId],
  );

  const dismissReceipt = useCallback(() => setLastReceipt(null), []);

  const holdCurrentSale = useCallback(
    async (note: string | null) => {
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
    [cart, cashierId, isOnline, storeId],
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
