import type { ReactNode } from "react";

/**
 * The summary-card row every redesigned admin list/detail page opens
 * with (POS Orders, Payment Verification, Customers, Users, Dealers,
 * Sellers, Business Associates, and the four profile pages) — a handful
 * of at-a-glance metrics in a responsive row of cards.
 */
export function StatCardsRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {children}
    </div>
  );
}

const TONE_ICON_BG: Record<StatTone, string> = {
  neutral: "bg-gray-100 text-gray-600",
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  purple: "bg-purple-100 text-purple-700",
};

const TONE_VALUE: Record<StatTone, string> = {
  neutral: "text-ink",
  green: "text-green-700",
  amber: "text-amber-700",
  red: "text-red-700",
  blue: "text-blue-700",
  purple: "text-purple-700",
};

export type StatTone = "neutral" | "green" | "amber" | "red" | "blue" | "purple";

export function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
  valueTone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Tints the icon chip. */
  tone?: StatTone;
  /** Tints the value text — defaults to the icon tone. */
  valueTone?: StatTone;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONE_ICON_BG[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500">{label}</div>
        <div className={`mt-0.5 text-2xl font-extrabold leading-tight ${TONE_VALUE[valueTone ?? tone]}`}>
          {value}
        </div>
        {hint && <div className="mt-0.5 truncate text-xs text-gray-500">{hint}</div>}
      </div>
    </div>
  );
}
