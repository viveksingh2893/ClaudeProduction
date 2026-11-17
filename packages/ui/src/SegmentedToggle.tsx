"use client";

/**
 * "use client" exception, same family as Modal/RowActionMenu — the sliding
 * highlight needs to know which option is active. A small, generic
 * 2-(or more-)option pill switch with an animated ("liquid") sliding
 * background that flows between options on click, rather than the options
 * merely re-coloring in place.
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const count = options.length;

  return (
    <div
      role="tablist"
      className={`relative inline-flex rounded-full border border-border bg-bg-dashboard p-1 ${className}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-1 rounded-full bg-green-700 shadow-card transition-all duration-300 ease-out"
        style={{
          width: `calc(${100 / count}% - 4px)`,
          left: `calc(${(100 / count) * activeIndex}% + 2px)`,
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={`relative z-10 min-w-[92px] rounded-full px-4 py-2 text-center text-sm font-semibold transition-colors ${
            opt.value === value ? "text-white" : "text-gray-600 hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
