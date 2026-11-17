"use client";

/**
 * India-only phone entry — Kisan4U operates India-only, so the "+91"
 * prefix is fixed and non-editable (no country selector), and the field
 * only ever collects the 10 local digits. Validation of what's typed
 * (length, digits-only, valid leading digit) happens at submit time in
 * each form via `isValidIndianMobileLocal`/`phoneSchema` — this
 * component doesn't silently strip/rewrite keystrokes, since "reject +91
 * typed inside the input" and similar cases are validation outcomes to
 * surface as an error, not something to auto-correct.
 */
export function PhoneInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border-[1.5px] border-border">
      <span className="flex items-center border-r border-border bg-green-50 px-3 text-sm font-semibold text-gray-600">+91</span>
      <input
        type="tel"
        inputMode="numeric"
        maxLength={10}
        placeholder="9876543210"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        required
        className="flex-1 px-3 py-2.5 text-sm outline-none"
      />
    </div>
  );
}
