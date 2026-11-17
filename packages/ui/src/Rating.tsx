"use client";

/**
 * "use client" exception, same family as DataTable — an editable star
 * control needs hover/focus/keyboard state. `StarRatingDisplay` (the
 * read-only half) would be state-free on its own, but lives here next to
 * its editable counterpart since both admin's manual-review form and the
 * storefront's review form/product pages need one or the other of the
 * exact same visual language.
 */

import { useRef } from "react";
import { Star } from "lucide-react";

/** Keyboard- and screen-reader-accessible 1-5 star picker — roving tabindex radiogroup (Tab enters/exits once, arrow keys move the selection). */
export function StarRatingInput({
  value,
  onChange,
  label = "Rating",
  size = "md",
  disabled = false,
}: {
  value: number;
  onChange: (rating: number) => void;
  label?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sizeClass = size === "sm" ? "h-5 w-5" : size === "lg" ? "h-8 w-8" : "h-6 w-6";
  const current = value || 0;

  function move(next: number) {
    const clamped = Math.min(5, Math.max(1, next));
    onChange(clamped);
    buttonRefs.current[clamped - 1]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          ref={(el) => {
            buttonRefs.current[n - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={current === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          tabIndex={n === (current || 1) ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(n)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              move((current || 1) + 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              move((current || 1) - 1);
            }
          }}
          className="rounded p-0.5 text-warning transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Star
            className={`${sizeClass} ${current >= n ? "fill-current" : "fill-none text-border"}`}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

/** Read-only star display with smooth partial fill for decimal averages (e.g. 4.3) — a single accessible label describes the whole rating, individual stars are decorative. */
export function StarRatingDisplay({
  average,
  size = "md",
  className = "",
}: {
  average: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-6 w-6" : "h-4.5 w-4.5";
  const fillPercent = Math.max(0, Math.min(100, (average / 5) * 100));
  return (
    <span className={`relative inline-flex ${className}`} aria-hidden="true">
      <span className="flex gap-0.5 text-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={sizeClass} aria-hidden="true" />
        ))}
      </span>
      <span
        className="absolute inset-0 flex gap-0.5 overflow-hidden text-warning"
        style={{ width: `${fillPercent}%` }}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={`${sizeClass} fill-current`} aria-hidden="true" />
        ))}
      </span>
    </span>
  );
}

/**
 * The full "4.3 out of 5 from 28 verified reviews" summary — one
 * accessible text label for the whole widget (per WCAG, decorative stars
 * shouldn't be individually announced). Shows a clean empty state instead
 * of a fabricated rating when there are zero verified reviews yet.
 */
export function RatingSummary({
  average,
  count,
  size = "md",
  className = "",
}: {
  average: number | null;
  count: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (average == null || count === 0) {
    return <span className={`text-xs font-medium text-gray-400 ${className}`}>No ratings yet</span>;
  }
  const label = `${average.toFixed(1)} out of 5 from ${count} verified review${count === 1 ? "" : "s"}`;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} role="img" aria-label={label}>
      <StarRatingDisplay average={average} size={size} />
      <span className="text-sm font-bold text-ink">{average.toFixed(1)}</span>
      <span className="text-xs text-gray-500">({count})</span>
    </span>
  );
}
