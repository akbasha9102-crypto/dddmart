"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSalesForExport } from "@/services/sales.service";
import type { SalesExportRow } from "@/services/sales.service";
import { formatDateTime } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { RangeDatePicker } from "@/components/features/sales/RangeDatePicker";
import type { CustomRange, PresetDays } from "@/components/features/sales/RangeDatePicker";

interface SalesExportModalProps {
  open: boolean;
  onClose: () => void;
}

const PAYMENT_METHOD_LABELS: Record<"cash" | "credit", string> = {
  cash: "نقدي",
  credit: "آجل",
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeForPreset(days: PresetDays): CustomRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

export function toExportRange(range: CustomRange): { startDate: Date; endDate: Date } {
  const startDate = new Date(range.startDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(range.endDate);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

function toSheetRow(row: SalesExportRow) {
  return {
    "رقم الفاتورة": row.invoiceNumber,
    "التاريخ والوقت": formatDateTime(row.createdAt),
    "الكاشير": row.cashierName,
    "طريقة الدفع": PAYMENT_METHOD_LABELS[row.paymentMethod],
    "عدد القطع": row.itemCount,
    "الخصم": row.discountAmount,
    "الإجمالي": row.totalAmount,
  };
}

/** Admin-only export of a date range's invoices to a downloadable .xlsx file — see docs/superpowers/specs/2026-08-14-sales-export-design.md. */
export function SalesExportModal({ open, onClose }: SalesExportModalProps) {
  const [preset, setPreset] = useState<PresetDays | null>(7);
  const [customRange, setCustomRange] = useState<CustomRange>(rangeForPreset(7));
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function handlePresetChange(days: PresetDays) {
    setPreset(days);
    setCustomRange(rangeForPreset(days));
  }

  function handleCustomRangeChange(range: CustomRange) {
    setPreset(null);
    setCustomRange(range);
  }

  async function handleExport() {
    if (!customRange.startDate || !customRange.endDate) {
      setError("الرجاء اختيار تاريخ البداية والنهاية");
      return;
    }

    setError(null);
    setIsExporting(true);
    try {
      const supabase = createClient();
      const { startDate, endDate } = toExportRange(customRange);
      const rows = await getSalesForExport(supabase, startDate, endDate);

      if (rows.length === 0) {
        setToastMessage("لا توجد مبيعات في الفترة المحددة");
        return;
      }

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(rows.map(toSheetRow));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "المبيعات");
      XLSX.writeFile(workbook, `مبيعات_${customRange.startDate}_${customRange.endDate}.xlsx`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تصدير الملف");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="تصدير المبيعات">
        <div className="flex flex-col gap-4">
          <RangeDatePicker
            preset={preset}
            customRange={customRange}
            onPresetChange={handlePresetChange}
            onCustomRangeChange={handleCustomRangeChange}
          />

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="button" onClick={handleExport} disabled={isExporting}>
              {isExporting ? "جارٍ التصدير..." : "تصدير Excel"}
            </Button>
          </div>
        </div>
      </Modal>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </>
  );
}
