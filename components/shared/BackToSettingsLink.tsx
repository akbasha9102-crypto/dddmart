import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface BackToSettingsLinkProps {
  href?: string;
  label?: string;
}

/** Back-to-/settings link shown above the title on each settings sub-page (sales, archive, employees). Always points at /settings regardless of navigation history, unless overridden via href (e.g. the employee detail page linking back to /employees). */
export function BackToSettingsLink({ href = "/settings", label = "الإعدادات" }: BackToSettingsLinkProps) {
  return (
    <Link href={href} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700">
      <ArrowRight className="h-4 w-4" />
      {label}
    </Link>
  );
}
