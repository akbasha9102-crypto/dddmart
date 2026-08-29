import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
}

/**
 * Renders the "MASHI" brand name followed by a standalone shopping-cart
 * glyph (handle, basket, two wheels) in place of the old "MART" text. Uses
 * `currentColor` so it inherits the caller's text color. Accepts className
 * so callers keep their own heading/link typography and color.
 */
export function BrandName({ className }: BrandNameProps) {
  return (
    <span className={cn(className)}>
      <span aria-hidden="true" className="inline-flex items-baseline gap-1.5">
        MASHI
        <svg
          className="inline-block h-[0.85em] w-[0.85em] translate-y-[0.15em]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 3 L4 3 L5 6" />
          <path d="M5 6 L19 6 L17 15 L7 15 Z" />
          <path d="M7 15 L9 20" />
          <path d="M17 15 L16 20" />
          <circle cx="9" cy="20" r="1.6" />
          <circle cx="16" cy="20" r="1.6" />
        </svg>
      </span>
      <span className="sr-only">MASHI</span>
    </span>
  );
}
