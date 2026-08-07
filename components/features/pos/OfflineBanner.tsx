"use client";

import { useState } from "react";
import { useOfflineContext } from "@/context/OfflineContext";
import { OfflineConflictModal } from "@/components/features/pos/OfflineConflictModal";

/**
 * Small banner at the top of the POS screen surfacing offline/sync state.
 * Hidden entirely when everything is normal (online, nothing pending, no
 * conflicts) so it adds zero visual noise during regular operation.
 */
export function OfflineBanner() {
  const { isOnline, pendingCount, conflictCount } = useOfflineContext();
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);

  if (isOnline && pendingCount === 0 && conflictCount === 0) {
    return null;
  }

  if (!isOnline) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-800">
        <span>أنت غير متصل بالإنترنت — سيتم حفظ المبيعات ومزامنتها تلقائياً عند عودة الاتصال</span>
        {pendingCount > 0 ? (
          <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold">{pendingCount}</span>
        ) : null}
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="rounded-lg bg-blue-100 px-4 py-2 text-sm text-blue-800">
        جارٍ مزامنة {pendingCount} عملية بيع معلّقة...
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsConflictModalOpen(true)}
        className="w-full rounded-lg bg-red-100 px-4 py-2 text-right text-sm text-red-800 underline-offset-2 hover:underline"
      >
        تعذرت مزامنة {conflictCount} عملية بيع بسبب نقص المخزون — راجع السجل
      </button>
      <OfflineConflictModal open={isConflictModalOpen} onClose={() => setIsConflictModalOpen(false)} />
    </>
  );
}
