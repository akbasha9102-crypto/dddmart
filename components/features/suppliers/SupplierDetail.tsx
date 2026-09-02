"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordSupplierPurchase, recordSupplierPayment } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import type { SupplierDetailData } from "@/services/suppliers.service";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SupplierProductPicker } from "@/components/features/suppliers/SupplierProductPicker";
import { BackButton } from "@/components/ui/BackButton";

interface SupplierDetailProps {
  detail: SupplierDetailData;
  onBack: () => void;
  onChanged: () => void;
}

/** Full transaction history + purchase/payment recording for one supplier. Linked-products management is added by SupplierProductPicker (rendered by the caller alongside this component). */
export function SupplierDetail({ detail, onBack, onChanged }: SupplierDetailProps) {
  const { user, storeId } = useAuth();
  const { supplier, balance, transactions, products } = detail;

  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  function openPurchaseModal() {
    setPurchaseAmount("");
    setPurchaseError(null);
    setIsPurchaseModalOpen(true);
  }

  async function handleSubmitPurchase(event: FormEvent) {
    event.preventDefault();
    setPurchaseError(null);
    setIsSubmittingPurchase(true);

    if (!storeId) {
      setPurchaseError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      setIsSubmittingPurchase(false);
      return;
    }

    try {
      const supabase = createClient();
      await recordSupplierPurchase(
        supabase,
        { supplierId: supplier.id, amount: Number(purchaseAmount) || 0 },
        user?.id ?? null,
        storeId,
      );
      setIsPurchaseModalOpen(false);
      onChanged();
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : "تعذر تسجيل الفاتورة");
    } finally {
      setIsSubmittingPurchase(false);
    }
  }

  function openPaymentModal() {
    setPaymentAmount(String(balance));
    setPaymentError(null);
    setIsPaymentModalOpen(true);
  }

  async function handleSubmitPayment(event: FormEvent) {
    event.preventDefault();
    setPaymentError(null);
    setIsSubmittingPayment(true);

    if (!storeId) {
      setPaymentError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      setIsSubmittingPayment(false);
      return;
    }

    try {
      const supabase = createClient();
      await recordSupplierPayment(
        supabase,
        { supplierId: supplier.id, amount: Number(paymentAmount) || 0 },
        user?.id ?? null,
        storeId,
      );
      setIsPaymentModalOpen(false);
      onChanged();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "تعذر تسجيل الدفعة");
    } finally {
      setIsSubmittingPayment(false);
    }
  }

  // Transactions arrive newest-first (services/suppliers.service.ts#getSupplier) — walk oldest-to-newest to compute each row's running balance (seeded from opening_balance), then display newest-first.
  const chronological = [...transactions].reverse();
  let cursor = supplier.opening_balance;
  const runningBalanceById = new Map<string, number>();
  chronological.forEach((transaction) => {
    cursor += transaction.type === "purchase" ? transaction.amount : -transaction.amount;
    runningBalanceById.set(transaction.id, cursor);
  });

  return (
    <div className="flex flex-col gap-4">
      <BackButton onClick={onBack} aria-label="رجوع لقائمة الموردين" className="w-fit" />

      <div>
        <h2 className="text-lg font-bold text-gray-900">{supplier.name}</h2>
        {supplier.phone ? <p className="text-sm text-gray-500">{supplier.phone}</p> : null}
      </div>

      <Card>
        <p className="text-sm text-gray-500">الرصيد المستحق</p>
        <p className={cn("text-xl font-bold", balance > 0 ? "text-red-600" : "text-gray-900")}>
          {formatCurrency(balance)}
        </p>
      </Card>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={openPurchaseModal}>
          تسجيل فاتورة شراء
        </Button>
        <Button variant="secondary" className="flex-1" disabled={balance <= 0} onClick={openPaymentModal}>
          تسجيل دفعة
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-700">الحركات</h3>
        {transactions.length === 0 ? (
          <p className="p-6 text-center text-gray-400">لا توجد حركات مسجلة</p>
        ) : (
          <Card className="p-0">
            <div className="flex flex-col divide-y divide-gray-100">
              {transactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-gray-900">
                      {transaction.type === "purchase" ? "فاتورة شراء" : "دفعة"}
                    </p>
                    <p className="text-xs text-gray-400">{formatDateTime(transaction.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={cn("text-sm font-semibold", transaction.type === "purchase" ? "text-red-600" : "text-green-600")}>
                      {transaction.type === "purchase" ? "+" : "-"}
                      {formatCurrency(transaction.amount)}
                    </span>
                    <span className="text-xs text-gray-400">
                      الرصيد: {formatCurrency(runningBalanceById.get(transaction.id) ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <SupplierProductPicker supplierId={supplier.id} products={products} onChanged={onChanged} />

      <Modal open={isPurchaseModalOpen} onClose={() => setIsPurchaseModalOpen(false)} title="تسجيل فاتورة شراء">
        <form onSubmit={handleSubmitPurchase} className="flex flex-col gap-4">
          <Input
            type="number"
            label="مبلغ الفاتورة"
            autoFocus
            min={0}
            value={purchaseAmount}
            onChange={(event) => setPurchaseAmount(event.target.value)}
          />
          {purchaseError ? <p className="text-sm text-red-600">{purchaseError}</p> : null}
          <Button type="submit" size="lg" disabled={isSubmittingPurchase}>
            {isSubmittingPurchase ? "جارٍ الحفظ..." : "تأكيد الفاتورة"}
          </Button>
        </form>
      </Modal>

      <Modal open={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="تسجيل دفعة">
        <form onSubmit={handleSubmitPayment} className="flex flex-col gap-4">
          <div className="flex justify-between text-sm text-gray-500">
            <span>الرصيد المستحق</span>
            <span className="font-medium text-gray-900">{formatCurrency(balance)}</span>
          </div>
          <Input
            type="number"
            label="مبلغ الدفعة"
            autoFocus
            min={0}
            max={balance}
            value={paymentAmount}
            onChange={(event) => setPaymentAmount(event.target.value)}
          />
          {paymentError ? <p className="text-sm text-red-600">{paymentError}</p> : null}
          <Button type="submit" size="lg" disabled={isSubmittingPayment}>
            {isSubmittingPayment ? "جارٍ الحفظ..." : "تأكيد الدفعة"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
