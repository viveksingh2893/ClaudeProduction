"use client";

/**
 * A wrapping row of equal-width language tabs. Unlike SegmentedToggle it has
 * no absolutely-positioned sliding highlight — the active tab just fills
 * solid green — so it stays aligned with 4-5 options of differing script
 * widths (English / हिंदी / मराठी / తెలుగు / தமிழ்) and wraps cleanly to a
 * second row in a narrow container instead of drifting out of place.
 */
export function LanguageTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Language",
  className = "",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex flex-wrap gap-1 rounded-xl border border-border bg-bg-dashboard p-1 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`min-w-[5rem] flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-sm font-semibold transition-colors ${
              active
                ? "bg-green-700 text-white shadow-card"
                : "text-gray-600 hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
