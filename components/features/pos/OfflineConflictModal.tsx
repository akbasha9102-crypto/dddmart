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
 * Lists sales that failed to sync due to insufficient real stock. The
 * outbox record itself stays status: "conflict" as a permanent audit trail
 * — "acknowledge" only dismisses the row from this modal's view, it does
 * not delete or resolve anything (no back-office admin screen for this is
 * in scope, see the offline mode plan's open risks).
 */
export function OfflineConflictModal({ open, onClose }: OfflineConflictModalProps) {
  const [conflicts, setConflicts] = useState<PendingSale[]>([]);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    void getOutbox().then((outbox) => setConflicts(outbox.filter((sale) => sale.status === "conflict")));
  }, [open]);

  const visibleConflicts = conflicts.filter((sale) => !acknowledgedIds.has(sale.localId));

  return (
    <Modal open={open} onClose={onClose} title="عمليات بيع تعذرت مزامنتها">
      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
        {visibleConflicts.length === 0 ? (
          <p className="text-center text-gray-400">لا توجد عمليات معلّقة</p>
        ) : (
          visibleConflicts.map((sale) => (
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
          ))
        )}
      </div>
    </Modal>
  );
}
