"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDateDDMMYYYY, parseDDMMYYYY, toDateInputValue } from "@kisan4u/ui";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A DD/MM/YYYY date field with a click-to-open month-grid calendar popover.
 * Replaces the native `<input type="date">` (whose displayed format is
 * locale-controlled and shows MM/DD/YYYY on a US-locale browser).
 *
 * The value in/out is still an ISO `YYYY-MM-DD` string ("" when unset), so
 * callers and the export API contract are unchanged — only what the user
 * sees and types is DD/MM/YYYY. Dates are handled as UTC midnight
 * throughout (same timezone-safety reasoning as @kisan4u/ui's date
 * helpers).
 */

const INPUT_BASE =
  "w-full rounded-md border-[1.5px] border-border px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-green-600";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isoToUtcDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function sameUtcDay(a: Date | null, b: Date | null): boolean {
  return (
    !!a &&
    !!b &&
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function CalendarDateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string; // ISO YYYY-MM-DD, "" when unset
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
}) {
  const fieldId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => isoToUtcDate(value), [value]);
  const minDate = useMemo(() => (min ? isoToUtcDate(min) : null), [min]);
  const maxDate = useMemo(() => (max ? isoToUtcDate(max) : null), [max]);

  const [text, setText] = useState(() => (selected ? formatDateDDMMYYYY(selected) : ""));
  const [viewMonth, setViewMonth] = useState<Date>(() => firstOfMonth(selected ?? new Date()));

  // Reflect an external value change (e.g. the sibling field clamping this
  // one) back into the visible text.
  useEffect(() => {
    setText(selected ? formatDateDDMMYYYY(selected) : "");
  }, [selected]);

  // Snap the visible month to the selected date each time the popover opens.
  useEffect(() => {
    if (open) setViewMonth(firstOfMonth(selected ?? new Date()));
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function isDisabled(d: Date): boolean {
    if (minDate && d.getTime() < minDate.getTime()) return true;
    if (maxDate && d.getTime() > maxDate.getTime()) return true;
    return false;
  }

  function handleTextChange(next: string) {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      onChange("");
      return;
    }
    const parsed = parseDDMMYYYY(trimmed);
    if (parsed.ok && !isDisabled(parsed.date)) onChange(toDateInputValue(parsed.date));
  }

  function pickDay(d: Date) {
    onChange(toDateInputValue(d));
    setOpen(false);
  }

  const year = viewMonth.getUTCFullYear();
  const month = viewMonth.getUTCMonth();
  // Monday-based weekday index of the 1st.
  const leadingBlanks = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leadingBlanks; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(Date.UTC(year, month, d)));

  return (
    <div className="flex flex-col gap-1.5" ref={rootRef}>
      <label htmlFor={fieldId} className="text-[12.5px] font-semibold text-gray-600">
        {label}
      </label>
      <div className="relative">
        <input
          id={fieldId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onFocus={() => setOpen(true)}
          className={`${INPUT_BASE} pr-10`}
        />
        <button
          type="button"
          aria-label="Open calendar"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-green-600"
        >
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
        </button>

        {open && (
          <div className="absolute left-0 z-30 mt-1 w-[17.5rem] rounded-lg border border-border bg-surface p-3 shadow-card">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setViewMonth(new Date(Date.UTC(year, month - 1, 1)))}
                className="rounded p-1 text-gray-500 hover:bg-black/5 hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="text-sm font-semibold text-ink">
                {MONTHS[month]} {year}
              </div>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setViewMonth(new Date(Date.UTC(year, month + 1, 1)))}
                className="rounded p-1 text-gray-500 hover:bg-black/5 hover:text-ink"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-gray-400">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) =>
                d === null ? (
                  <div key={`blank-${i}`} />
                ) : (
                  <button
                    key={toDateInputValue(d)}
                    type="button"
                    disabled={isDisabled(d)}
                    onClick={() => pickDay(d)}
                    className={`rounded py-1 text-sm ${
                      sameUtcDay(d, selected)
                        ? "bg-green-600 font-semibold text-white"
                        : "text-ink hover:bg-green-50"
                    } disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent`}
                  >
                    {d.getUTCDate()}
                  </button>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
