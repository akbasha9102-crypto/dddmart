import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface BackToSettingsLinkProps {
  label?: string;
}

/** Back-to-/settings link shown above the title on each settings sub-page (sales, archive, employees). Always points at /settings regardless of navigation history. */
export function BackToSettingsLink({ label = "الإعدادات" }: BackToSettingsLinkProps) {
  return (
    <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700">
      <ArrowRight className="h-4 w-4" />
      {label}
    </Link>
  );
}
