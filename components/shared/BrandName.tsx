import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
}

/**
 * Renders the "ماشي" brand name followed by a standalone solid grocery-cart
 * glyph (angled handle, grid-basket body, two wheels, item silhouettes
 * peeking over the rim). Uses `currentColor` so it inherits the caller's
 * text color. Accepts className so callers keep their own heading/link
 * typography and color.
 *
 * The wordmark forces `dir="ltr"`: every caller renders inside the app's
 * RTL document (`app/layout.tsx`), and without an explicit direction the
 * browser's bidi algorithm reverses the flex order, pushing the cart icon
 * to the wrong side of the word instead of gluing it to the word's edge.
 */
export function BrandName({ className }: BrandNameProps) {
  return (
    <span className={cn("font-extrabold", className)}>
      <span dir="ltr" aria-hidden="true" className="inline-flex items-baseline">
        ماشي
        <svg
          className="inline-block h-[0.9em] w-[1.05em] translate-y-[0.12em]"
          viewBox="0 0 28 24"
          fill="currentColor"
        >
          {/* Handle: angled bar sticking up and out from the basket's top-left */}
          <path d="M1 2.5 A1.5 1.5 0 0 1 2.4 0.6 L5.6 0.9 A1.5 1.5 0 0 1 6.9 2.1 L7.4 4 L1.9 4 Z" />

          {/* Grocery items peeking above the basket rim */}
          <rect x="12.5" y="1.5" width="2.6" height="4.5" rx="0.6" />
          <rect x="15.7" y="2.6" width="3.2" height="3.4" rx="0.5" />
          <rect x="19.4" y="3.2" width="3" height="2.8" rx="0.5" />

          {/* Basket body: trapezoid frame */}
          <path d="M2 5 H24.5 L22.6 15 A1.4 1.4 0 0 1 21.2 16.1 H9 A1.4 1.4 0 0 1 7.6 15 Z M4 7 L8.6 14 H21.7 L23.4 7 Z" fillRule="evenodd" />

          {/* Basket grid lines */}
          <rect x="10.5" y="7" width="1.1" height="7" />
          <rect x="15.2" y="7" width="1.1" height="7" />
          <rect x="19.9" y="7" width="1.1" height="7" />
          <rect x="6" y="9.3" width="18" height="1.1" />
          <rect x="6.9" y="12" width="16.6" height="1.1" />

          {/* Wheels */}
          <circle cx="11" cy="20.5" r="2.4" />
          <circle cx="19.5" cy="20.5" r="2.4" />
        </svg>
      </span>
      <span className="sr-only">ماشي</span>
    </span>
  );
}
