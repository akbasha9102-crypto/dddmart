"use client";

import { Button } from "@/components/ui/Button";

interface ConfirmInlineProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}

/** Inline yes/no confirmation, used instead of a nested modal-over-modal (better on mobile). */
export function ConfirmInline({ message, onConfirm, onCancel, confirmLabel = "تأكيد" }: ConfirmInlineProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
      <span className="flex-1 text-sm font-medium text-red-700">{message}</span>
      <Button type="button" size="sm" variant="danger" onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
        إلغاء
      </Button>
    </div>
  );
}
