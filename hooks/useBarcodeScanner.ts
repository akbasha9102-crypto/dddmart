"use client";

import { useEffect, useRef } from "react";

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  /** Barcodes shorter than this are treated as accidental keystrokes. */
  minLength?: number;
  /** Gap (ms) above which we assume the buffer belongs to a new scan. */
  resetGapMs?: number;
  enabled?: boolean;
}

/**
 * Captures input from keyboard-emulating (HID) barcode scanners: they type
 * digits far faster than a human and terminate with Enter. Keystrokes are
 * ignored while focus is on a form field so manual typing/search isn't
 * hijacked mid-scan.
 */
export function useBarcodeScanner({
  onScan,
  minLength = 4,
  resetGapMs = 200,
  enabled = true,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTypingField = !!target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (isTypingField) return;

      const now = performance.now();
      if (now - lastKeyTimeRef.current > resetGapMs) {
        bufferRef.current = "";
      }
      lastKeyTimeRef.current = now;

      if (event.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= minLength) {
          event.preventDefault();
          onScan(code);
        }
        return;
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onScan, minLength, resetGapMs, enabled]);
}
