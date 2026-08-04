import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label ? (
          <label htmlFor={id} className="text-sm font-medium text-gray-700">
            {label}
          </label>
        ) : null}
        <input
          ref={ref}
          id={id}
          className={cn(
            "h-11 rounded-lg border border-gray-300 px-3 text-base outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200",
            error && "border-red-500 focus:border-red-500 focus:ring-red-200",
            className,
          )}
          {...props}
        />
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
    );
  },
);

Input.displayName = "Input";
