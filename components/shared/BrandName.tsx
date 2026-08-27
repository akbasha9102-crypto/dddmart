import { cn } from "@/lib/utils";

interface BrandNameProps {
  className?: string;
}

/**
 * Renders the "MASHI MART" brand name as real, selectable text, with the R
 * in "MART" horizontally mirrored as a branding flourish (Toys "Я" Us-style,
 * done as an actual CSS mirror of the glyph rather than a substitute
 * character). Accepts className so callers keep their own heading/link
 * typography and color.
 */
export function BrandName({ className }: BrandNameProps) {
  return (
    <span className={cn(className)}>
      <span aria-hidden="true">
        MASHI MA
        <span className="inline-block" style={{ transform: "scaleX(-1)" }}>
          R
        </span>
        T
      </span>
      <span className="sr-only">MASHI MART</span>
    </span>
  );
}
