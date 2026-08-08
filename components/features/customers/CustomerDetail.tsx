"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { recordPayment } from "@/services/customers.service";
import { useAuth } from "@/context/AuthContext";
import type { CustomerDetail as CustomerDetailData } from "@/services/customers.service";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { CustomerStatementPrinter } from "@/components/features/customers/CustomerStatementPrinter";

interface CustomerDetailProps {
  detail: CustomerDetailData;
  onBack: () => void;
  onChanged: () => void;
}

/** Full transaction history + payment recording + statement printing for one customer. */
export function CustomerDetail({ detail, onBack, onChanged }: CustomerDetailProps) {
  const { user, storeId } = useAuth();
  const { customer, balance, transactions } = detail;

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isStatementOpen, setIsStatementOpen] = useState(false);

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
      await recordPayment(
        supabase,
        { customerId: customer.id, amount: Number(paymentAmount) || 0 },
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

  // Transactions arrive newest-first (services/customers.service.ts#getCustomer) — walk oldest-to-newest to compute each row's running balance, then display newest-first.
  const chronological = [...transactions].reverse();
  let cursor = 0;
  const runningBalanceById = new Map<string, number>();
  chronological.forEach((transaction) => {
    cursor += transaction.type === "sale" ? transaction.amount : -transaction.amount;
    runningBalanceById.set(transaction.id, cursor);
  });

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
      >
        <ArrowRight className="h-4 w-4" />
        رجوع لقائمة الزبائن
      </button>

      <div>
        <h2 className="text-lg font-bold text-gray-900">{customer.name}</h2>
        {customer.phone ? <p className="text-sm text-gray-500">{customer.phone}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-sm text-gray-500">الرصيد الحالي</p>
          <p className={cn("text-xl font-bold", balance > 0 ? "text-red-600" : "text-gray-900")}>
            {formatCurrency(balance)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">حد الائتمان</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(customer.credit_limit)}</p>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" disabled={balance <= 0} onClick={openPaymentModal}>
          تسديد دفعة
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => setIsStatementOpen(true)}>
          طباعة كشف حساب
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
                      {transaction.type === "sale" ? "بيع بالآجل" : "دفعة"}
                    </p>
                    <p className="text-xs text-gray-400">{formatDateTime(transaction.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={cn("text-sm font-semibold", transaction.type === "sale" ? "text-red-600" : "text-green-600")}>
                      {transaction.type === "sale" ? "+" : "-"}
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

      <Modal open={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="تسديد دفعة">
        <form onSubmit={handleSubmitPayment} className="flex flex-col gap-4">
          <div className="flex justify-between text-sm text-gray-500">
            <span>الرصيد الحالي</span>
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

      <Modal open={isStatementOpen} onClose={() => setIsStatementOpen(false)} title="كشف حساب">
        <CustomerStatementPrinter
          customer={customer}
          transactions={transactions}
          balance={balance}
          onClose={() => setIsStatementOpen(false)}
        />
      </Modal>
    </div>
  );
}
