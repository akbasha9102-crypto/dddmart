import { BackButton } from "@/components/ui/BackButton";

interface BackToSettingsLinkProps {
  href?: string;
  label?: string;
}

/** Back-to-/settings link shown above the title on each settings sub-page (sales, archive, employees). Always points at /settings regardless of navigation history, unless overridden via href (e.g. the employee detail page linking back to /employees). */
export function BackToSettingsLink({ href = "/settings", label = "الإعدادات" }: BackToSettingsLinkProps) {
  return <BackButton href={href} aria-label={label} className="mb-2" />;
}
