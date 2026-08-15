"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Shift } from "@/types/shifts";

interface ShiftGateProps {
  shift: Shift | null;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  onOpen: (openingBalance: number) => Promise<void>;
}

/**
 * Blocks POS usage until the cashier has an open shift. Renders nothing
 * once one exists (or while still loading). Otherwise renders a
 * non-dismissable Modal (onClose is a no-op, so Escape/backdrop-click
 * can't close it) asking for the opening cash balance.
 */
export function ShiftGate({ shift, isLoading, isSubmitting, error, onOpen }: ShiftGateProps) {
  const [openingBalance, setOpeningBalance] = useState("");

  if (isLoading || shift) return null;

  const balanceNumber = Number(openingBalance);
  const isValid = openingBalance !== "" && Number.isFinite(balanceNumber) && balanceNumber >= 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid) return;
    await onOpen(balanceNumber);
  }

  return (
    <Modal open onClose={() => {}} title="فتح وردية جديدة">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">أدخل الرصيد الافتتاحي بالصندوق قبل بدء البيع.</p>
        <Input
          label="الرصيد الافتتاحي"
          type="number"
          min={0}
          step="0.01"
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          autoFocus
          required
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={!isValid || isSubmitting}>
          {isSubmitting ? "جارٍ الفتح..." : "فتح الوردية والبدء بالبيع"}
        </Button>
      </form>
    </Modal>
  );
}
