import type { ReactNode } from "react";
import { AlertTriangle, Info, XCircle } from "lucide-react";

export type AlertTone = "amber" | "red" | "blue";

const TONE_CLASSES: Record<AlertTone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-900",
  blue: "border-blue-200 bg-blue-50 text-blue-900",
};

const TONE_ICON: Record<AlertTone, ReactNode> = {
  amber: <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />,
  red: <XCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />,
  blue: <Info className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />,
};

/**
 * A "needs attention" style banner used across the redesigned admin list
 * pages (stale pending applications, missing verification, overdue
 * proofs, etc). Optionally links to the filtered view that explains it.
 */
export function AlertBanner({
  tone = "amber",
  title,
  description,
  href,
  linkLabel = "View",
}: {
  tone?: AlertTone;
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${TONE_CLASSES[tone]}`}>
      {TONE_ICON[tone]}
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        {description && <div className="mt-0.5 text-[13px] opacity-90">{description}</div>}
      </div>
      {href && (
        <a href={href} className="shrink-0 whitespace-nowrap text-sm font-semibold underline underline-offset-2">
          {linkLabel} →
        </a>
      )}
    </div>
  );
}

export function AlertBannerStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}
