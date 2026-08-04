"use client";

import { useEffect } from "react";

interface QuickKeysProps {
  onCheckout: () => void;
  onClear: () => void;
}

const SHORTCUTS = [
  { key: "F2", label: "دفع" },
  { key: "F4", label: "تفريغ السلة" },
  { key: "Esc", label: "إغلاق النافذة" },
];

/**
 * Global keyboard shortcuts for cashier speed — avoids reaching for the
 * mouse mid-rush. Ignores keystrokes while typing in a form field so it
 * doesn't hijack manual barcode entry or numeric input.
 */
export function QuickKeys({ onCheckout, onClear }: QuickKeysProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTypingField = !!target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

      if (event.key === "F2") {
        event.preventDefault();
        onCheckout();
        return;
      }

      if (event.key === "F4" && !isTypingField) {
        event.preventDefault();
        onClear();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCheckout, onClear]);

  return (
    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
      {SHORTCUTS.map((shortcut) => (
        <span key={shortcut.key}>
          <kbd className="rounded border border-gray-300 px-1.5 py-0.5 font-mono">{shortcut.key}</kbd> {shortcut.label}
        </span>
      ))}
    </div>
  );
}
