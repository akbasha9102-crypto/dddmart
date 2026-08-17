"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listHeldSales, cancelHeldSale } from "@/services/heldSales.service";
import { getPendingHeldSales } from "@/lib/offline/outbox";
import { usePOSContext } from "@/context/POSContext";
import { calculateTotals } from "@/types/pos";
import type { CartItem } from "@/types/pos";
import type { HeldSale } from "@/types/heldSales";
import type { PendingHeldSale } from "@/types/offline";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface HeldSalesListProps {
  onResumed: () => void;
  activeCartHasItems: boolean;
  onCountChange: (count: number) => void;
}

export function HeldSalesList({ onResumed, activeCartHasItems, onCountChange }: HeldSalesListProps) {
  const { resumeSale, resumePendingHeldSale } = usePOSContext();
  const [heldSales, setHeldSales] = useState<HeldSale[] | null>(null);
  const [pendingHeldSales, setPendingHeldSales] = useState<PendingHeldSale[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [guardMessage, setGuardMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void listHeldSales(supabase).then((rows) => {
      if (cancelled) return;
      setHeldSales(rows);
    });
    void getPendingHeldSales().then((rows) => {
      if (cancelled) return;
      setPendingHeldSales(rows.filter((sale) => sale.status !== "synced"));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onCountChange((heldSales?.length ?? 0) + pendingHeldSales.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldSales, pendingHeldSales]);

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

  async function handleResumePending(localId: string) {
    if (activeCartHasItems) {
      setGuardMessage("أفرغ أو علّق السلة الحالية أولاً قبل استرجاع فاتورة معلقة");
      return;
    }
    setBusyId(localId);
    try {
      await resumePendingHeldSale(localId);
      setPendingHeldSales((prev) => prev.filter((sale) => sale.localId !== localId));
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
      setHeldSales((prev) => (prev ?? []).filter((r) => r.id !== row.id));
      setConfirmingId(null);
    } finally {
      setBusyId(null);
    }
  }

  if (heldSales === null) return <p className="p-4 text-center text-gray-400">جارٍ التحميل...</p>;
  if (heldSales.length === 0 && pendingHeldSales.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا توجد فواتير معلقة</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {guardMessage ? <p className="text-sm text-red-600">{guardMessage}</p> : null}
      {pendingHeldSales.length > 0 ? (
        <div className="flex flex-col divide-y divide-amber-100">
          {pendingHeldSales.map((sale) => {
            const { totalAmount } = calculateTotals(sale.items, sale.discountAmount);
            return (
              <div key={sale.localId} className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{sale.note || "بدون اسم"}</span>
                      <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        غير متزامنة
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {sale.items.length} صنف · {formatDateTime(sale.createdAt)}
                    </span>
                  </div>
                  <span className="font-semibold text-gray-900">{formatCurrency(totalAmount)}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === sale.localId}
                    onClick={() => handleResumePending(sale.localId)}
                  >
                    استرجاع
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
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
