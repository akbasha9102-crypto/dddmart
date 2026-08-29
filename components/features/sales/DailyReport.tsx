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
import {
  Banknote,
  TrendingUp,
  Receipt,
  Percent,
  Undo2,
  PackageX,
  Scale,
  Calculator,
  Package,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

interface DailyReportProps {
  report: DailyReportDetails;
}

export function DailyReport({ report }: DailyReportProps) {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
            <Receipt className="h-4 w-4" />
          </span>
          <p className="mt-2 text-sm text-gray-500">عدد الفواتير</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{report.salesCount}</p>
        </Card>
        <Card>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Banknote className="h-4 w-4" />
          </span>
          <p className="mt-2 text-sm text-gray-500">إجمالي المبيعات</p>
          <p className="mt-1 text-3xl font-bold text-brand-700">{formatCurrency(report.totalRevenue)}</p>
        </Card>
        <Card>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 text-green-700">
            <TrendingUp className="h-4 w-4" />
          </span>
          <p className="mt-2 text-sm text-gray-500">صافي الربح</p>
          <p className="mt-1 text-3xl font-bold text-green-700">{formatCurrency(report.totalProfit)}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">تقديري</p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Calculator className="h-3.5 w-3.5" />
          </span>
          <p className="mt-2 text-sm text-gray-500">متوسط الفاتورة</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.averageInvoiceValue)}</p>
        </Card>
        <Card>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Package className="h-3.5 w-3.5" />
          </span>
          <p className="mt-2 text-sm text-gray-500">إجمالي القطع المباعة</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{report.totalItemsSold}</p>
        </Card>
        <Card>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Percent className="h-3.5 w-3.5" />
          </span>
          <p className="mt-2 text-sm text-gray-500">إجمالي الخصومات</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalDiscountGiven)}</p>
        </Card>
        <Card>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Undo2 className="h-3.5 w-3.5" />
          </span>
          <p className="mt-2 text-sm text-gray-500">إجمالي المرتجعات</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalReturnsValue)}</p>
        </Card>
        <Card>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <PackageX className="h-3.5 w-3.5" />
          </span>
          <p className="mt-2 text-sm text-gray-500">إجمالي الخسائر</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalDamageLoss)}</p>
        </Card>
        <Card>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Scale className="h-3.5 w-3.5" />
          </span>
          <p className="mt-2 text-sm text-gray-500">فروقات الجرد</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.totalReconciliationLoss)}</p>
        </Card>
        {report.highestInvoice ? (
          <Card>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <ArrowUp className="h-3.5 w-3.5" />
            </span>
            <p className="mt-2 text-sm text-gray-500">أعلى فاتورة</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(report.highestInvoice.total_amount)}</p>
            <p className="mt-0.5 text-xs text-gray-400">{report.highestInvoice.invoice_number}</p>
          </Card>
        ) : null}
        {report.lowestInvoice ? (
          <Card>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <ArrowDown className="h-3.5 w-3.5" />
            </span>
            <p className="mt-2 text-sm text-gray-500">أدنى فاتورة</p>
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
                className="flex items-center justify-between gap-3 py-3 text-right hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <Receipt className="h-4 w-4" />
                  </span>
                  <div className="flex flex-col">
                    <span className="font-mono text-sm text-gray-700">{sale.invoice_number}</span>
                    <span className="text-xs text-gray-500">{formatTime(sale.created_at)}</span>
                  </div>
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
