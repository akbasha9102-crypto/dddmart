"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { getOutbox } from "@/lib/offline/db";
import type { PendingSale } from "@/types/offline";

interface OfflineConflictModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Lists sales that failed to sync due to insufficient real stock
 * ("conflict"), and separately, sales where real stock was already
 * decremented but the sale record itself never made it to the server
 * ("partial" — see audit item #9). Both outbox record kinds stay in their
 * status permanently as an audit trail — "acknowledge" only dismisses the
 * row from this modal's view, it does not delete or resolve anything (no
 * back-office admin screen for this is in scope, see the offline mode
 * plan's open risks). Partial sales are listed in their own section above
 * conflicts since they represent a more urgent, less-understood risk
 * (possible unrecorded sale with real stock/money impact, not just a
 * routine stock shortfall) and shouldn't be visually conflated with them.
 */
export function OfflineConflictModal({ open, onClose }: OfflineConflictModalProps) {
  const [conflicts, setConflicts] = useState<PendingSale[]>([]);
  const [partials, setPartials] = useState<PendingSale[]>([]);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    void getOutbox().then((outbox) => {
      setConflicts(outbox.filter((sale) => sale.status === "conflict"));
      setPartials(outbox.filter((sale) => sale.status === "partial"));
    });
  }, [open]);

  const visibleConflicts = conflicts.filter((sale) => !acknowledgedIds.has(sale.localId));
  const visiblePartials = partials.filter((sale) => !acknowledgedIds.has(sale.localId));

  return (
    <Modal open={open} onClose={onClose} title="عمليات بيع تعذرت مزامنتها">
      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
        {visiblePartials.length === 0 && visibleConflicts.length === 0 ? (
          <p className="text-center text-gray-400">لا توجد عمليات معلّقة</p>
        ) : (
          <>
            {visiblePartials.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold text-red-900">
                  عمليات خُصم مخزونها دون تسجيل الفاتورة — تتطلب مراجعة يدوية عاجلة
                </p>
                {visiblePartials.map((sale) => (
                  <div key={sale.localId} className="rounded-lg border border-red-400 bg-red-100 p-3 text-sm">
                    <p className="font-semibold text-gray-900">فاتورة {sale.invoiceNumber}</p>
                    <p className="mt-1 text-red-900">
                      تم خصم المخزون فعلياً لهذه الفاتورة لكن لم يتم تسجيل عملية البيع — يرجى مراجعة المخزون والسجلات
                      يدوياً للتأكد من عدم وجود فرق غير موثّق
                    </p>
                    <ul className="mt-2 flex flex-col gap-1 text-gray-600">
                      {sale.payload.items.map((item, index) => (
                        <li key={`${item.productId}-${index}`}>
                          {item.name} — الكمية: {item.quantity}
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => setAcknowledgedIds((prev) => new Set(prev).add(sale.localId))}
                    >
                      تم الاطلاع
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {visibleConflicts.map((sale) => (
              <div key={sale.localId} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-semibold text-gray-900">فاتورة {sale.invoiceNumber}</p>
                <p className="mt-1 text-red-700">
                  الكمية المتوفرة غير كافية — تم بيع الكمية المتبقية فقط، يرجى المراجعة يدوياً
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-gray-600">
                  {sale.conflicts?.map((conflict, index) => (
                    <li key={`${conflict.productId}-${index}`}>
                      {conflict.productName} — الكمية المطلوبة: {conflict.requestedBaseUnits}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setAcknowledgedIds((prev) => new Set(prev).add(sale.localId))}
                >
                  تم الاطلاع
                </Button>
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
