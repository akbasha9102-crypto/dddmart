"use client";

import { useState } from "react";
import type { Sale } from "@/types/pos";
import { formatCurrency, formatTime } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { InvoiceView } from "./InvoiceView";

interface DailyReportProps {
  sales: Sale[];
  totalRevenue: number;
  totalProfit: number;
}

export function DailyReport({ sales, totalRevenue, totalProfit }: DailyReportProps) {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-sm text-gray-500">عدد الفواتير</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{sales.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">إجمالي المبيعات</p>
          <p className="mt-1 text-2xl font-bold text-brand-700">{formatCurrency(totalRevenue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">صافي الربح التقديري</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(totalProfit)}</p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        {sales.length === 0 ? (
          <p className="p-6 text-center text-gray-400">لا توجد مبيعات اليوم بعد</p>
        ) : (
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-100 text-gray-500">
              <tr>
                <th className="p-3 font-medium">رقم الفاتورة</th>
                <th className="p-3 font-medium">الوقت</th>
                <th className="p-3 font-medium">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr
                  key={sale.id}
                  className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                  onClick={() => setSelectedSale(sale)}
                >
                  <td className="p-3 font-mono text-gray-700">{sale.invoice_number}</td>
                  <td className="p-3 text-gray-500">{formatTime(sale.created_at)}</td>
                  <td className="p-3 font-semibold text-gray-900">{formatCurrency(sale.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={selectedSale !== null} onClose={() => setSelectedSale(null)} title="تفاصيل الفاتورة">
        {selectedSale ? <InvoiceView sale={selectedSale} onClose={() => setSelectedSale(null)} /> : null}
      </Modal>
    </div>
  );
}
