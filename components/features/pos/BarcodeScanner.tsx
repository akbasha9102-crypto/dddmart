"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { usePOSContext } from "@/context/POSContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/**
 * Dual-mode barcode entry: a physical HID scanner fires keystrokes globally
 * (captured by useBarcodeScanner), while this input also accepts manual
 * typing for damaged/unreadable barcodes. Autofocused and refocused after
 * every scan so the cashier never has to click back into it.
 */
export function BarcodeScanner() {
  const { scanBarcode, isScanning, scanError } = usePOSContext();
  const [manualValue, setManualValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useBarcodeScanner({
    onScan: (barcode) => {
      void scanBarcode(barcode);
      inputRef.current?.focus();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = manualValue.trim();
    if (!trimmed) return;
    void scanBarcode(trimmed);
    setManualValue("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        ref={inputRef}
        autoFocus
        value={manualValue}
        onChange={(event) => setManualValue(event.target.value)}
        placeholder="امسح الباركود أو أدخله يدوياً..."
        className="flex-1 text-lg"
        aria-label="باركود المنتج"
      />
      <Button type="submit" size="lg" disabled={isScanning}>
        {isScanning ? "..." : "إضافة"}
      </Button>
      {scanError ? (
        <div className="absolute mt-14 rounded-lg bg-red-100 px-3 py-1 text-sm text-red-700">{scanError}</div>
      ) : null}
    </form>
  );
}
