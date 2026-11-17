import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps } from "react";
import { Loader2 } from "lucide-react";

/**
 * Single Button primitive with variants instead of separate
 * Primary/Secondary/Outline/Danger components — same visual language,
 * fewer near-duplicate files. `variant="primary"` is the earth-toned CTA
 * (Buy Now, Place Order, Submit); `secondary` is the green-outline lower
 * commitment action (Add to Cart); `outline`/`ghost`/`danger` cover the
 * remaining cases (filters, cancel, destructive actions).
 */
export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-2",
  md: "text-sm px-5 py-3",
  lg: "text-[15px] px-6 py-3.5",
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-earth-600 text-white hover:bg-earth-700",
  secondary: "bg-transparent text-green-700 border-[1.5px] border-green-600 hover:bg-green-50",
  outline: "bg-white text-ink border border-border hover:border-green-600",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "bg-transparent text-green-700 hover:bg-green-50",
};

function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean | undefined,
  className: string,
) {
  return [BASE, SIZE_CLASSES[size], VARIANT_CLASSES[variant], fullWidth ? "w-full" : "", className]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner and disables the button without changing its width — children stay in place (opacity-0) so the layout doesn't jump when a row action starts a server round-trip. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  className = "",
  type = "button",
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`relative ${buttonClasses(variant, size, fullWidth, className)}`}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        </span>
      )}
      <span className={`inline-flex items-center gap-2 ${loading ? "invisible" : ""}`}>
        {children}
      </span>
    </button>
  );
}

export type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

/** Same visual button, rendered as a Next.js Link for navigation (Buy Now, View All, ...). */
export function LinkButton({
  variant = "primary",
  size = "md",
  fullWidth,
  className = "",
  ...props
}: LinkButtonProps) {
  return <Link className={buttonClasses(variant, size, fullWidth, className)} {...props} />;
}

export type AnchorButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

/** Same visual button as a plain <a> — for external/mailto/tel links where next/link doesn't apply. */
export function AnchorButton({
  variant = "primary",
  size = "md",
  fullWidth,
  className = "",
  ...props
}: AnchorButtonProps) {
  return <a className={buttonClasses(variant, size, fullWidth, className)} {...props} />;
}
