"use client";

import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Generic pill-style tab switcher. Wraps on narrow screens instead of scrolling horizontally. */
export function Tabs<T extends string>({ options, value, onChange, className }: TabsProps<T>) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
            value === option.value
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-gray-200 bg-white text-gray-600",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
