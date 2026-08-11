"use client";

import { useState } from "react";
import type { DailyReportDetails } from "@/services/sales.service";
import { formatCurrency, formatTime } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { InvoiceView } from "./InvoiceView";
import { DailyComparisonCards } from "./DailyComparisonCards";
import { HourlyBreakdownChart } from "./HourlyBreakdownChart";
import type { Sale } from "@/types/pos";

interface DailyReportProps {
  report: DailyReportDetails;
}

export function DailyReport({ report }: DailyReportProps) {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-gray-500">عدد الفواتير</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{report.salesCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">إجمالي المبيعات</p>
          <p className="mt-1 text-2xl font-bold text-brand-700">{formatCurrency(report.totalRevenue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">صافي الربح</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(report.totalProfit)}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">تقديري</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">متوسط الفاتورة</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.averageInvoiceValue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">إجمالي القطع المباعة</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{report.totalItemsSold}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">إجمالي الخصومات</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalDiscountGiven)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">إجمالي المرتجعات</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalReturnsValue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">إجمالي الخسائر</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalDamageLoss)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">فروقات الجرد</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalReconciliationLoss)}</p>
        </Card>
        {report.highestInvoice ? (
          <Card>
            <p className="text-sm text-gray-500">أعلى فاتورة</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.highestInvoice.total_amount)}</p>
            <p className="mt-0.5 text-xs text-gray-400">{report.highestInvoice.invoice_number}</p>
          </Card>
        ) : null}
        {report.lowestInvoice ? (
          <Card>
            <p className="text-sm text-gray-500">أدنى فاتورة</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.lowestInvoice.total_amount)}</p>
            <p className="mt-0.5 text-xs text-gray-400">{report.lowestInvoice.invoice_number}</p>
          </Card>
        ) : null}
      </div>

      <DailyComparisonCards
        comparisonWithYesterday={report.comparisonWithYesterday}
        comparisonWithLastWeekSameDay={report.comparisonWithLastWeekSameDay}
      />

      <HourlyBreakdownChart data={report.hourlyBreakdown} />

      <Card className="p-0">
        <p className="p-4 pb-2 text-sm font-medium text-gray-700">فواتير اليوم</p>
        {report.sales.length === 0 ? (
          <p className="p-6 text-center text-gray-400">لا توجد مبيعات اليوم بعد</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100 px-4 pb-4">
            {report.sales.map((sale) => (
              <button
                key={sale.id}
                type="button"
                onClick={() => setSelectedSale(sale)}
                className="flex items-center justify-between gap-3 py-3 text-right"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-sm text-gray-700">{sale.invoice_number}</span>
                  <span className="text-xs text-gray-500">{formatTime(sale.created_at)}</span>
                </div>
                <span className="font-semibold text-gray-900">{formatCurrency(sale.total_amount)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Modal open={selectedSale !== null} onClose={() => setSelectedSale(null)} title="تفاصيل الفاتورة">
        {selectedSale ? <InvoiceView sale={selectedSale} onClose={() => setSelectedSale(null)} /> : null}
      </Modal>
    </div>
  );
}
