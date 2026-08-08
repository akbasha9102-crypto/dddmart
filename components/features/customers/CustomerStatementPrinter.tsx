"use client";

import type { Customer, CustomerTransaction } from "@/types/customer";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface CustomerStatementPrinterProps {
  customer: Customer;
  transactions: CustomerTransaction[];
  balance: number;
  onClose: () => void;
}

/**
 * 80mm-wide thermal account statement (كشف حساب) for a customer, reusing
 * ReceiptPrinter's exact #receipt id / @media print pattern from
 * app/globals.css — zero CSS changes needed.
 *
 * NOTE: #receipt is a single global id. ReceiptPrinter and this component
 * are never rendered simultaneously in the current app flows (one lives on
 * /pos, the other on /customers), so that's safe today — but flag it as a
 * latent constraint if the two are ever combined into one view later.
 */
export function CustomerStatementPrinter({ customer, transactions, balance, onClose }: CustomerStatementPrinterProps) {
  // Statement is chronological oldest-first, unlike CustomerDetail's newest-first history list.
  const chronological = [...transactions].reverse();

  let runningBalance = 0;
  const rows = chronological.map((transaction) => {
    runningBalance += transaction.type === "sale" ? transaction.amount : -transaction.amount;
    return { transaction, runningBalance };
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <div id="receipt" className="w-[80mm] max-w-full bg-white p-3 font-mono text-xs text-black">
        <div className="text-center">
          <p className="text-base font-bold">DDD Mart</p>
          <p>كشف حساب</p>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <p>الزبون: {customer.name}</p>
        {customer.phone ? <p>الهاتف: {customer.phone}</p> : null}
        <p>تاريخ الطباعة: {formatDateTime(new Date())}</p>
        <hr className="my-2 border-dashed border-black" />
        {rows.length === 0 ? (
          <p className="text-center">لا توجد حركات مسجلة</p>
        ) : (
          rows.map(({ transaction, runningBalance: rowBalance }) => (
            <div key={transaction.id} className="mb-1">
              <div className="flex justify-between">
                <span>{transaction.type === "sale" ? "بيع بالآجل" : "دفعة"}</span>
                <span>{formatDateTime(transaction.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span>
                  {transaction.type === "sale" ? "+" : "-"}
                  {formatCurrency(transaction.amount)}
                </span>
                <span>الرصيد: {formatCurrency(rowBalance)}</span>
              </div>
            </div>
          ))
        )}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between text-sm font-bold">
          <span>الرصيد المستحق الحالي</span>
          <span>{formatCurrency(balance)}</span>
        </div>
      </div>

      <div className="flex gap-3 print:hidden">
        <Button onClick={() => window.print()}>طباعة الكشف</Button>
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </div>
  );
}
