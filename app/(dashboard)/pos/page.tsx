"use client";

import { useEffect, useState } from "react";
import { usePOSContext } from "@/context/POSContext";
import { BarcodeScanner } from "@/components/features/pos/BarcodeScanner";
import { CartGrid } from "@/components/features/pos/CartGrid";
import { ReceiptPrinter } from "@/components/features/pos/ReceiptPrinter";
import { OfflineBanner } from "@/components/features/pos/OfflineBanner";
import { ReturnLookup } from "@/components/features/pos/ReturnLookup";
import { HeldSalesList } from "@/components/features/pos/HeldSalesList";
import { CustomerPicker } from "@/components/features/pos/CustomerPicker";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrency, cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { listHeldSales } from "@/services/heldSales.service";
import { getCustomerBalance } from "@/services/customers.service";
import type { CustomerWithBalance } from "@/types/customer";
import type { PaymentMethod } from "@/types/database.types";

type POSView = "cashier" | "held" | "returns";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "نقد" },
  { value: "credit", label: "بالآجل" },
];

const POS_VIEWS: { value: POSView; label: string }[] = [
  { value: "cashier", label: "الكاشير" },
  { value: "held", label: "المعلقة" },
  { value: "returns", label: "المرتجعات" },
];

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
    isOnline,
  } = usePOSContext();

  const [activeView, setActiveView] = useState<POSView>("cashier");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [heldCount, setHeldCount] = useState(0);
  const [isHoldNoteOpen, setIsHoldNoteOpen] = useState(false);
  const [holdNote, setHoldNote] = useState("");
  const [isHolding, setIsHolding] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithBalance | null>(null);
  const [overLimitWarning, setOverLimitWarning] = useState<string | null>(null);

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
    setPaymentMethod("cash");
    setSelectedCustomer(null);
    setOverLimitWarning(null);
    setIsCheckoutOpen(true);
  }

  async function handleSelectCustomer(customer: CustomerWithBalance | null) {
    setSelectedCustomer(customer);
    setOverLimitWarning(null);

    if (!customer) return;

    // Non-blocking warning only (confirmed store policy) — the cashier can
    // still complete the sale even when this pushes the customer over their
    // credit limit.
    const supabase = createClient();
    const liveBalance = await getCustomerBalance(supabase, customer.id);
    const projectedBalance = liveBalance + totals.totalAmount;
    if (customer.credit_limit > 0 && projectedBalance > customer.credit_limit) {
      setOverLimitWarning(
        `تنبيه: هذه العملية ستتجاوز حد الائتمان المسموح به (${formatCurrency(customer.credit_limit)}) — الرصيد المتوقع: ${formatCurrency(projectedBalance)}`,
      );
    }
  }

  async function handleConfirmPayment() {
    if (paymentMethod === "credit") {
      if (!selectedCustomer) return;
      await checkout({
        paidAmount: 0,
        paymentMethod: "credit",
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
      });
    } else {
      await checkout({ paidAmount: Number(paidAmount) || 0, paymentMethod: "cash" });
    }
    setIsCheckoutOpen(false);
  }

  const paidNumber = Number(paidAmount) || 0;
  const change = Math.max(paidNumber - totals.totalAmount, 0);

  return (
    <div className="-m-3 flex h-[calc(100vh-4rem-4.25rem)] flex-col overflow-hidden bg-gray-50 lg:-m-6 lg:h-[calc(100vh-4rem)]">
      <header className="shrink-0 border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="shrink-0 text-base font-bold text-brand-700">شاشة الكاشير</h1>
          <div role="tablist" className="flex flex-1 max-w-xs items-center gap-1 rounded-full bg-gray-100 p-1">
            {POS_VIEWS.map((view) => (
              <button
                key={view.value}
                type="button"
                role="tab"
                aria-selected={activeView === view.value}
                onClick={() => setActiveView(view.value)}
                className={cn(
                  "relative flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-2 text-xs font-semibold transition-colors sm:text-sm",
                  activeView === view.value ? "bg-white text-brand-700 shadow-sm" : "text-gray-500",
                )}
              >
                {view.label}
                {view.value === "held" && heldCount > 0 ? (
                  <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                    {heldCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="px-3 pt-3">
        <OfflineBanner />
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row lg:gap-4 lg:p-4">
        {activeView === "cashier" ? (
          <>
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 bg-white p-3">
                <BarcodeScanner />
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
                <CartGrid />
              </div>
            </section>

            <aside className="flex w-full shrink-0 flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 lg:w-80">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>المجموع الفرعي</span>
                  <span className="font-medium text-gray-700">{formatCurrency(totals.subtotal)}</span>
                </div>
                <Input
                  type="number"
                  label="الخصم"
                  min={0}
                  value={discountAmount || ""}
                  onChange={(event) => setDiscountAmount(Number(event.target.value) || 0)}
                />
              </div>

              <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">الإجمالي</span>
                  <span className="text-2xl font-bold text-brand-700">{formatCurrency(totals.totalAmount)}</span>
                </div>

                <Button size="xl" className="w-full" disabled={items.length === 0} onClick={openCheckout}>
                  دفع
                </Button>

                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" disabled={items.length === 0} onClick={openHoldModal}>
                    تعليق
                  </Button>
                  <Button variant="ghost" className="flex-1" disabled={items.length === 0} onClick={clear}>
                    تفريغ السلة
                  </Button>
                </div>
              </div>
            </aside>
          </>
        ) : activeView === "held" ? (
          <section className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3">
            <HeldSalesList
              activeCartHasItems={items.length > 0}
              onCountChange={setHeldCount}
              onResumed={() => setActiveView("cashier")}
            />
          </section>
        ) : (
          <section className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3">
            <ReturnLookup />
          </section>
        )}
      </div>

      <Modal open={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)} title="إتمام الدفع">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between text-lg">
            <span>الإجمالي المطلوب</span>
            <span className="font-bold">{formatCurrency(totals.totalAmount)}</span>
          </div>

          <div role="tablist" className="flex items-center gap-1 rounded-full bg-gray-100 p-1">
            {PAYMENT_METHODS.map((method) => {
              const disabled = method.value === "credit" && !isOnline;
              return (
                <button
                  key={method.value}
                  type="button"
                  role="tab"
                  aria-selected={paymentMethod === method.value}
                  disabled={disabled}
                  onClick={() => setPaymentMethod(method.value)}
                  className={cn(
                    "flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    paymentMethod === method.value ? "bg-white text-brand-700 shadow-sm" : "text-gray-500",
                  )}
                >
                  {method.label}
                </button>
              );
            })}
          </div>

          {paymentMethod === "credit" ? (
            <>
              <CustomerPicker value={selectedCustomer} onChange={handleSelectCustomer} />
              {overLimitWarning ? (
                <div className="rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-800">{overLimitWarning}</div>
              ) : null}
            </>
          ) : (
            <>
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
            </>
          )}

          <Button
            size="lg"
            disabled={isCheckingOut || (paymentMethod === "credit" ? !selectedCustomer : paidNumber < totals.totalAmount)}
            onClick={handleConfirmPayment}
          >
            {isCheckingOut ? "جارٍ الحفظ..." : "تأكيد الدفع"}
          </Button>
        </div>
      </Modal>

      <Modal open={lastReceipt !== null} onClose={dismissReceipt} title="تمت عملية البيع">
        {lastReceipt ? <ReceiptPrinter receipt={lastReceipt} onClose={dismissReceipt} /> : null}
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
    </div>
  );
}
