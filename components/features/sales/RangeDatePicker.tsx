"use client";

import { cn } from "@/lib/utils";

export type PresetDays = 7 | 30 | 90;

export interface CustomRange {
  startDate: string;
  endDate: string;
}

const PRESETS: { value: PresetDays; label: string }[] = [
  { value: 7, label: "آخر 7 أيام" },
  { value: 30, label: "آخر 30 يوماً" },
  { value: 90, label: "آخر 90 يوماً" },
];

interface RangeDatePickerProps {
  preset: PresetDays | null;
  customRange: CustomRange;
  onPresetChange: (days: PresetDays) => void;
  onCustomRangeChange: (range: CustomRange) => void;
}

/** Preset 7/30/90-day buttons plus two native date inputs for a fully custom range. Selecting a date clears the active preset. */
export function RangeDatePicker({ preset, customRange, onPresetChange, onCustomRangeChange }: RangeDatePickerProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onPresetChange(option.value)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              preset === option.value
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-gray-200 bg-white text-gray-600",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <label className="flex items-center gap-2">
          من
          <input
            type="date"
            value={customRange.startDate}
            max={customRange.endDate || undefined}
            onChange={(event) => onCustomRangeChange({ ...customRange, startDate: event.target.value })}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2">
          إلى
          <input
            type="date"
            value={customRange.endDate}
            min={customRange.startDate || undefined}
            onChange={(event) => onCustomRangeChange({ ...customRange, endDate: event.target.value })}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
    </div>
  );
}
