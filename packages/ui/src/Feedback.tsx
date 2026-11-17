import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface px-6 py-16 text-center">
      {icon && <div className="text-4xl text-gray-400">{icon}</div>}
      <div className="text-base font-bold text-ink">{title}</div>
      {description && <p className="max-w-sm text-sm text-gray-600">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-600" role="status" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-border border-t-green-600" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export type AlertTone = "success" | "warning" | "danger" | "info";

const ALERT_CLASSES: Record<AlertTone, string> = {
  success: "bg-success-bg text-success border-success/25",
  warning: "bg-warning-bg text-warning border-warning/25",
  danger: "bg-danger-bg text-danger border-danger/25",
  info: "bg-info-bg text-info border-info/25",
};

export function AlertBox({
  tone = "info",
  title,
  children,
  className = "",
}: {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={`rounded-lg border px-4 py-3 text-sm ${ALERT_CLASSES[tone]} ${className}`}>
      {title && <div className="mb-0.5 font-bold">{title}</div>}
      <div>{children}</div>
    </div>
  );
}
