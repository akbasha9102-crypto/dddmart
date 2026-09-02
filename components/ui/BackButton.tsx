import { forwardRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface BackButtonBaseProps {
  "aria-label": string;
  className?: string;
}

interface BackButtonLinkProps extends BackButtonBaseProps {
  href: string;
  onClick?: never;
}

interface BackButtonClickProps extends BackButtonBaseProps {
  onClick: () => void;
  href?: never;
}

type BackButtonProps = BackButtonLinkProps | BackButtonClickProps;

const backButtonClassName =
  "flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200 active:bg-gray-300";

export const BackButton = forwardRef<HTMLAnchorElement | HTMLButtonElement, BackButtonProps>(
  (props, ref) => {
    const { className, "aria-label": ariaLabel } = props;

    if ("href" in props && props.href) {
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={props.href}
          aria-label={ariaLabel}
          className={cn(backButtonClassName, className)}
        >
          <ArrowRight className="h-5 w-5" />
        </Link>
      );
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={(props as BackButtonClickProps).onClick}
        aria-label={ariaLabel}
        className={cn(backButtonClassName, className)}
      >
        <ArrowRight className="h-5 w-5" />
      </button>
    );
  },
);

BackButton.displayName = "BackButton";
