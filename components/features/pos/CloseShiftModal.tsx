"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateExpectedAmount } from "@/services/shifts.service";
import { formatCurrency } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Shift } from "@/types/shifts";

interface CloseShiftModalProps {
  shift: Shift;
  open: boolean;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (countedAmount: number) => Promise<void>;
}

/**
 * Shows a live-computed expected cash amount (recomputed fresh each time
 * this opens -- not trusted from any earlier render), then asks the
 * cashier to enter what they actually counted. The real difference is
 * computed again, atomically, inside closeShift itself at submit time --
 * this preview is for the cashier's benefit, not the source of truth.
 */
export function CloseShiftModal({ shift, open, isSubmitting, error, onClose, onConfirm }: CloseShiftModalProps) {
  const [expectedAmount, setExpectedAmount] = useState<number | null>(null);
  const [countedAmount, setCountedAmount] = useState("");

  useEffect(() => {
    if (!open) return;
    setExpectedAmount(null);
    setCountedAmount("");
    const supabase = createClient();
    calculateExpectedAmount(supabase, shift, new Date()).then(setExpectedAmount);
  }, [open, shift]);

  const countedNumber = Number(countedAmount);
  const isValid = countedAmount !== "" && Number.isFinite(countedNumber) && countedNumber >= 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid) return;
    await onConfirm(countedNumber);
  }

  return (
    <Modal open={open} onClose={onClose} title="إغلاق الوردية">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          المبلغ المتوقع بالصندوق:{" "}
          <span className="font-semibold text-gray-900">
            {expectedAmount === null ? "جارٍ الحساب..." : formatCurrency(expectedAmount)}
          </span>
        </p>
        <Input
          label="المبلغ المعدود فعلياً"
          type="number"
          min={0}
          step="0.01"
          value={countedAmount}
          onChange={(event) => setCountedAmount(event.target.value)}
          autoFocus
          required
        />
        {isValid && expectedAmount !== null ? (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            الفرق: {formatCurrency(countedNumber - expectedAmount)}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" disabled={!isValid || isSubmitting}>
            {isSubmitting ? "جارٍ الإغلاق..." : "تأكيد إغلاق الوردية"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
