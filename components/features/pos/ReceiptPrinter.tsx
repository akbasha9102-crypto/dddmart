"use client";

import type { CompletedSale } from "@/types/pos";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface ReceiptPrinterProps {
  receipt: CompletedSale;
  onClose: () => void;
}

/** 80mm-wide thermal receipt. Only #receipt is visible when printing — see app/globals.css. */
export function ReceiptPrinter({ receipt, onClose }: ReceiptPrinterProps) {
  const { sale, items, changeAmount } = receipt;

  return (
    <div className="flex flex-col items-center gap-4">
      <div id="receipt" className="w-[80mm] max-w-full bg-white p-3 font-mono text-xs text-black">
        <div className="text-center">
          <p className="text-base font-bold">DDD Mart</p>
          <p>فاتورة بيع نقدي</p>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <p>رقم الفاتورة: {sale.invoice_number}</p>
        <p>التاريخ: {formatDateTime(sale.created_at)}</p>
        <hr className="my-2 border-dashed border-black" />
        {items.map((item) => (
          <div key={item.id} className="mb-1">
            <p>
              {item.product_name}
              {item.unit_label ? ` (${item.unit_label})` : ""}
            </p>
            <div className="flex justify-between">
              <span>
                {item.quantity} × {formatCurrency(item.unit_price)}
              </span>
              <span>{formatCurrency(item.total_price)}</span>
            </div>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between">
          <span>المجموع الفرعي</span>
          <span>{formatCurrency(sale.subtotal)}</span>
        </div>
        {sale.discount_amount > 0 ? (
          <div className="flex justify-between">
            <span>الخصم</span>
            <span>-{formatCurrency(sale.discount_amount)}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-sm font-bold">
          <span>الإجمالي</span>
          <span>{formatCurrency(sale.total_amount)}</span>
        </div>
        <div className="flex justify-between">
          <span>المدفوع</span>
          <span>{formatCurrency(sale.paid_amount)}</span>
        </div>
        <div className="flex justify-between">
          <span>الباقي</span>
          <span>{formatCurrency(changeAmount)}</span>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center">شكراً لزيارتكم</p>
      </div>

      <div className="flex gap-3 print:hidden">
        <Button onClick={() => window.print()}>طباعة الفاتورة</Button>
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </div>
  );
}
