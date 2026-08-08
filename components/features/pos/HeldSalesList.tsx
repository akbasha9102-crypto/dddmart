"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listHeldSales, cancelHeldSale } from "@/services/heldSales.service";
import { usePOSContext } from "@/context/POSContext";
import { calculateTotals } from "@/types/pos";
import type { CartItem } from "@/types/pos";
import type { HeldSale } from "@/types/heldSales";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface HeldSalesListProps {
  onResumed: () => void;
  activeCartHasItems: boolean;
  onCountChange: (count: number) => void;
}

export function HeldSalesList({ onResumed, activeCartHasItems, onCountChange }: HeldSalesListProps) {
  const { resumeSale } = usePOSContext();
  const [heldSales, setHeldSales] = useState<HeldSale[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [guardMessage, setGuardMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void listHeldSales(supabase).then((rows) => {
      if (cancelled) return;
      setHeldSales(rows);
      onCountChange(rows.length);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleResume(id: string) {
    if (activeCartHasItems) {
      setGuardMessage("أفرغ أو علّق السلة الحالية أولاً قبل استرجاع فاتورة معلقة");
      return;
    }
    setBusyId(id);
    try {
      await resumeSale(id);
      onResumed();
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(row: HeldSale) {
    setBusyId(row.id);
    try {
      const supabase = createClient();
      await cancelHeldSale(supabase, row.id, row.items as unknown as CartItem[]);
      setHeldSales((prev) => {
        const next = (prev ?? []).filter((r) => r.id !== row.id);
        onCountChange(next.length);
        return next;
      });
      setConfirmingId(null);
    } finally {
      setBusyId(null);
    }
  }

  if (heldSales === null) return <p className="p-4 text-center text-gray-400">جارٍ التحميل...</p>;
  if (heldSales.length === 0) return <p className="p-6 text-center text-gray-400">لا توجد فواتير معلقة</p>;

  return (
    <div className="flex flex-col gap-3">
      {guardMessage ? <p className="text-sm text-red-600">{guardMessage}</p> : null}
      <div className="flex flex-col divide-y divide-gray-100">
        {heldSales.map((row) => {
          const items = row.items as unknown as CartItem[];
          const { totalAmount } = calculateTotals(items, row.discount_amount);
          return (
            <div key={row.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="font-medium text-gray-900">{row.note || "بدون اسم"}</span>
                  <span className="text-xs text-gray-500">
                    {items.length} صنف · {formatDateTime(row.created_at)}
                  </span>
                </div>
                <span className="font-semibold text-gray-900">{formatCurrency(totalAmount)}</span>
              </div>
              {confirmingId === row.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-600">تأكيد حذف الفاتورة المعلقة؟ سيتم إرجاع الكمية للمخزون.</span>
                  <Button size="sm" variant="danger" disabled={busyId === row.id} onClick={() => handleCancel(row)}>
                    تأكيد
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                    إلغاء
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" disabled={busyId === row.id} onClick={() => handleResume(row.id)}>
                    استرجاع
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => setConfirmingId(row.id)}>
                    حذف
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
