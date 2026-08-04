"use client";

import { cn } from "@/lib/utils";

interface ColorSwatchPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}

const COLOR_PALETTE = [
  "#129055",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#65a30d",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#57534e",
];

/** Fixed palette of tappable circle swatches — deliberately not a native color wheel, which is harder to use on small touchscreens. */
export function ColorSwatchPicker({ value, onChange, label = "لون القسم" }: ColorSwatchPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="flex flex-wrap gap-3">
        {COLOR_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            aria-label={hex}
            aria-pressed={value === hex}
            className={cn(
              "h-10 w-10 rounded-full transition-transform",
              value === hex && "ring-2 ring-offset-2 ring-brand-500",
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
    </div>
  );
}
