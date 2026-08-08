"use client";

import { useEffect, useState } from "react";
import { usePOSContext } from "@/context/POSContext";
import { BarcodeScanner } from "@/components/features/pos/BarcodeScanner";
import { CartGrid } from "@/components/features/pos/CartGrid";
import { ReceiptPrinter } from "@/components/features/pos/ReceiptPrinter";
import { OfflineBanner } from "@/components/features/pos/OfflineBanner";
import { ReturnLookup } from "@/components/features/pos/ReturnLookup";
import { HeldSalesList } from "@/components/features/pos/HeldSalesList";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { listHeldSales } from "@/services/heldSales.service";

export default function POSPage() {
  const {
    items,
    totals,
    discountAmount,
    setDiscountAmount,
    clear,
    checkout,
    isCheckingOut,
    lastReceipt,
    dismissReceipt,
    holdCurrentSale,
  } = usePOSContext();

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [isReturnsOpen, setIsReturnsOpen] = useState(false);
  const [isHeldSalesOpen, setIsHeldSalesOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [isHoldNoteOpen, setIsHoldNoteOpen] = useState(false);
  const [holdNote, setHoldNote] = useState("");
  const [isHolding, setIsHolding] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void listHeldSales(supabase).then((rows) => setHeldCount(rows.length));
  }, []);

  function openHoldModal() {
    if (items.length === 0) return;
    setHoldNote("");
    setIsHoldNoteOpen(true);
  }

  async function handleConfirmHold() {
    setIsHolding(true);
    try {
      await holdCurrentSale(holdNote.trim() || null);
      setHeldCount((count) => count + 1);
      setIsHoldNoteOpen(false);
    } finally {
      setIsHolding(false);
    }
  }

  function openCheckout() {
    if (items.length === 0) return;
    setPaidAmount(String(totals.totalAmount));
    setIsCheckoutOpen(true);
  }

  async function handleConfirmPayment() {
    await checkout(Number(paidAmount) || 0);
    setIsCheckoutOpen(false);
  }

  const paidNumber = Number(paidAmount) || 0;
  const change = Math.max(paidNumber - totals.totalAmount, 0);

  return (
    <div className="-m-3 flex h-[calc(100vh-4rem-4.25rem)] flex-col overflow-hidden bg-gray-50 lg:-m-6 lg:h-[calc(100vh-4rem)]">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-lg font-bold text-brand-700">شاشة الكاشير</h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsHeldSalesOpen(true)}>
            الفواتير المعلقة
            {heldCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white">
                {heldCount}
              </span>
            ) : null}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsReturnsOpen(true)}>
            المرتجعات
          </Button>
        </div>
      </header>

      <div className="px-4 pt-4">
        <OfflineBanner />
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-xl border border-gray-200 bg-white p-4">
          <div className="relative">
            <BarcodeScanner />
          </div>
          <CartGrid />
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 lg:w-80">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">المجموع الفرعي</span>
              <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
            </div>
            <Input
              type="number"
              label="الخصم"
              min={0}
              value={discountAmount || ""}
              onChange={(event) => setDiscountAmount(Number(event.target.value) || 0)}
            />
            <div className="flex justify-between border-t border-gray-200 pt-2 text-lg font-bold text-brand-700">
              <span>الإجمالي</span>
              <span>{formatCurrency(totals.totalAmount)}</span>
            </div>
          </div>

          <Button size="xl" className="mt-auto" disabled={items.length === 0} onClick={openCheckout}>
            دفع
          </Button>
          <Button variant="secondary" disabled={items.length === 0} onClick={openHoldModal}>
            تعليق
          </Button>
          <Button variant="ghost" disabled={items.length === 0} onClick={clear}>
            تفريغ السلة
          </Button>
        </aside>
      </div>

      <Modal open={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)} title="إتمام الدفع">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between text-lg">
            <span>الإجمالي المطلوب</span>
            <span className="font-bold">{formatCurrency(totals.totalAmount)}</span>
          </div>
          <Input
            type="number"
            label="المبلغ المستلم"
            autoFocus
            value={paidAmount}
            onChange={(event) => setPaidAmount(event.target.value)}
            min={0}
          />
          <div className="flex justify-between text-base">
            <span className="text-gray-500">الباقي</span>
            <span className="font-semibold">{formatCurrency(change)}</span>
          </div>
          <Button size="lg" disabled={isCheckingOut || paidNumber < totals.totalAmount} onClick={handleConfirmPayment}>
            {isCheckingOut ? "جارٍ الحفظ..." : "تأكيد الدفع"}
          </Button>
        </div>
      </Modal>

      <Modal open={lastReceipt !== null} onClose={dismissReceipt} title="تمت عملية البيع">
        {lastReceipt ? <ReceiptPrinter receipt={lastReceipt} onClose={dismissReceipt} /> : null}
      </Modal>

      <Modal open={isReturnsOpen} onClose={() => setIsReturnsOpen(false)} title="مرتجعات اليوم">
        <ReturnLookup />
      </Modal>

      <Modal open={isHoldNoteOpen} onClose={() => setIsHoldNoteOpen(false)} title="تعليق الفاتورة">
        <div className="flex flex-col gap-4">
          <Input
            type="text"
            label="ملاحظة (اختياري، مثال: اسم الزبون)"
            autoFocus
            value={holdNote}
            onChange={(event) => setHoldNote(event.target.value)}
          />
          <Button size="lg" disabled={isHolding} onClick={handleConfirmHold}>
            {isHolding ? "جارٍ التعليق..." : "تعليق الفاتورة"}
          </Button>
        </div>
      </Modal>

      <Modal open={isHeldSalesOpen} onClose={() => setIsHeldSalesOpen(false)} title="الفواتير المعلقة">
        <HeldSalesList
          activeCartHasItems={items.length > 0}
          onCountChange={setHeldCount}
          onResumed={() => setIsHeldSalesOpen(false)}
        />
      </Modal>
    </div>
  );
}
