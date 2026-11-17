"use client";

import { useState } from "react";

/**
 * Quantity control for the product page: − / + buttons around a number the
 * shopper can also type directly. A plain text field with numeric input
 * mode on purpose (not `type="number"`), so scrolling over it or pressing
 * the arrow keys can never nudge the value by accident.
 *
 * The value reported through `onChange` is always a valid quantity
 * (clamped to `min`..`max`), even while the field is momentarily empty or
 * below `min` mid-typing — so whatever button is pressed next always acts on
 * a sensible number. The field itself shows exactly what was typed until it
 * loses focus, then snaps to the clamped value.
 */
export function QuantityInput({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  className = "",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  /** Upper bound (e.g. stock on hand). Never lower than `min`. */
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  const upper = max !== undefined ? Math.max(min, max) : Number.POSITIVE_INFINITY;
  const clamp = (n: number) => Math.min(upper, Math.max(min, n));
  // Non-null only while the shopper is typing in the field.
  const [draft, setDraft] = useState<string | null>(null);

  function step(delta: number) {
    setDraft(null);
    onChange(clamp(value + delta));
  }

  return (
    <div
      className={`inline-flex shrink-0 items-center rounded-md border-[1.5px] border-border bg-surface ${className}`}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={disabled || value <= min}
        className="flex h-9 w-8 items-center justify-center text-base font-bold text-ink disabled:opacity-40"
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="Quantity"
        value={draft ?? String(value)}
        disabled={disabled}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 5);
          setDraft(digits);
          const parsed = parseInt(digits, 10);
          onChange(Number.isFinite(parsed) ? clamp(parsed) : min);
        }}
        onBlur={() => setDraft(null)}
        className="h-9 w-11 border-x border-border bg-transparent text-center text-sm font-bold text-ink outline-none focus:bg-green-50"
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={disabled || value >= upper}
        className="flex h-9 w-8 items-center justify-center text-base font-bold text-ink disabled:opacity-40"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}
