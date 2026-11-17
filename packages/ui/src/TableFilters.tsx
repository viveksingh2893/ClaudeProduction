"use client";

/**
 * "use client" exception, same family as DataTable — filter controls
 * write to the URL (see useTableUrlState.ts) so a table's filter
 * selection survives reload/back-forward exactly like page/sort/search.
 */

import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useUrlFilterParam } from "./useTableUrlState";

const SELECT_CLASS =
  "rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-green-600";

/** A single-select filter (status, role, audience, ...) synced to a URL query param — the standard filter control for this table system. */
export function TableFilterSelect({
  paramKey,
  label,
  options,
  className = "",
}: {
  paramKey: string;
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const [value, setValue] = useUrlFilterParam(paramKey);
  return (
    <select
      value={value}
      onChange={(e) => setValue(e.target.value || null)}
      aria-label={label}
      className={`${SELECT_CLASS} ${className}`}
    >
      <option value="">{label}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** A from/to date-range filter synced to two URL query params. */
export function TableFilterDateRange({
  fromParamKey,
  toParamKey,
  label,
}: {
  fromParamKey: string;
  toParamKey: string;
  label: string;
}) {
  const [from, setFrom] = useUrlFilterParam(fromParamKey);
  const [to, setTo] = useUrlFilterParam(toParamKey);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value || null)}
        aria-label={`${label} from`}
        className={`${SELECT_CLASS} w-[9.5rem]`}
      />
      <span className="text-xs text-gray-400">to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value || null)}
        aria-label={`${label} to`}
        className={`${SELECT_CLASS} w-[9.5rem]`}
      />
    </div>
  );
}

/**
 * Collapses an arbitrary set of filter controls behind a "Filters" button
 * on narrow screens (a proper sheet, not a squeezed-in row) while showing
 * them inline on desktop — the primary search field stays visible either
 * way since it's rendered outside this wrapper by AdminDataTable itself.
 */
export function FilterDrawer({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 md:flex">{children}</div>
      <div className="md:hidden">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Filters
          {count > 0 && (
            <span className="ml-0.5 rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {count}
            </span>
          )}
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Filters">
        <div className="flex flex-col gap-3">{children}</div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="primary" size="sm" onClick={() => setOpen(false)}>
            Show results
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** "N filters active · Clear all" — rendered next to the search box when at least one filter/search is set. */
export function ActiveFilterSummary({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800 hover:bg-green-100"
    >
      {count} {count === 1 ? "filter" : "filters"} active
      <X className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
