"use client";

import { useState } from "react";
import { FormInput } from "@kisan4u/ui";

/** Keeps digits and at most one decimal point, with at most two decimal places. */
function sanitizeAmount(raw: string): string {
  let out = raw.replace(/[^\d.]/g, "");
  const dot = out.indexOf(".");
  if (dot !== -1) {
    out = out.slice(0, dot + 1) + out.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  }
  return out;
}

/**
 * A rupee amount the operator types in — and nothing else can change.
 *
 * Deliberately a text field with a numeric keypad (`inputMode="decimal"`),
 * not `type="number"`: a number input's value can be nudged by the mouse
 * wheel, the spinner arrows and the ArrowUp / ArrowDown keys, and on a POS
 * payment screen a stray scroll over the box silently changed the amount
 * being charged. A text field has none of those, so only typed digits ever
 * reach the value. Anything that isn't a digit or a single decimal point is
 * dropped as it's typed.
 *
 * While the field has focus it shows exactly what was typed (so "12." isn't
 * rewritten to "12" mid-keystroke); when it loses focus it shows the value
 * the parent settled on (e.g. after the "Use max" button or a clamp).
 * `onChange` always receives a plain number (0 when the field is empty).
 */
export function MoneyAmountInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (amount: number) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value > 0 ? String(value) : "");

  return (
    <FormInput
      label={label}
      hint={hint}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={(e) => {
        const cleaned = sanitizeAmount(e.target.value);
        setDraft(cleaned);
        const parsed = cleaned === "" || cleaned === "." ? 0 : Number(cleaned);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
