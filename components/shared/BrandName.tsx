import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
}

/**
 * Renders the "MASHI MART" brand name as real, selectable text, with the R
 * in "MART" replaced by a shopping-cart glyph: a vertical stem (cart frame),
 * an open basket in place of the bowl, a diagonal rear strut in place of the
 * leg, and two wheels where the R's legs would meet the baseline. It still
 * reads as "R" at a glance while doubling as the cart icon. Uses
 * `currentColor` so it inherits the caller's text color. Accepts className
 * so callers keep their own heading/link typography and color.
 */
export function BrandName({ className }: BrandNameProps) {
  return (
    <span className={cn(className)}>
      <span aria-hidden="true" className="inline-flex items-baseline">
        MASHI MA
        <svg
          className="inline-block h-[0.85em] w-[0.85em] translate-y-[0.12em]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 4 L4 2" />
          <path d="M7 4 L7 19" />
          <path d="M7 4 L17 4 L15 11 L7 11" />
          <path d="M13 11 L19 19" />
          <circle cx="7" cy="21" r="1.6" />
          <circle cx="19" cy="21" r="1.6" />
        </svg>
        T
      </span>
      <span className="sr-only">MASHI MART</span>
    </span>
  );
}
