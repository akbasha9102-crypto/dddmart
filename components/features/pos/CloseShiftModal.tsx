"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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
 * Asks the cashier to enter what they actually counted in the drawer.
 * The expected amount and the resulting difference are computed and
 * stored server-side inside closeShift at submit time -- they are never
 * sent to the browser, so a cashier cannot tune their entered count to
 * match the expected value and hide a shortage.
 */
export function CloseShiftModal({ shift, open, isSubmitting, error, onClose, onConfirm }: CloseShiftModalProps) {
  const [countedAmount, setCountedAmount] = useState("");

  useEffect(() => {
    if (!open) return;
    setCountedAmount("");
  }, [open]);

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
