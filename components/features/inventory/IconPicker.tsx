"use client";

import { CATEGORY_ICON_CHOICES, getCategoryIcon } from "@/lib/categoryIcons";
import { cn } from "@/lib/utils";

interface IconPickerProps {
  value: string;
  onChange: (iconKey: string) => void;
  label?: string;
}

/** Grid of the fixed ~19-icon category vocabulary — small enough that no search is needed. */
export function IconPicker({ value, onChange, label = "أيقونة القسم" }: IconPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="grid grid-cols-5 gap-2">
        {CATEGORY_ICON_CHOICES.map((iconKey) => {
          const Icon = getCategoryIcon(iconKey);
          return (
            <button
              key={iconKey}
              type="button"
              onClick={() => onChange(iconKey)}
              aria-label={iconKey}
              aria-pressed={value === iconKey}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50",
                value === iconKey && "border-brand-600 bg-brand-50 text-brand-700 ring-2 ring-offset-2 ring-brand-500",
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
