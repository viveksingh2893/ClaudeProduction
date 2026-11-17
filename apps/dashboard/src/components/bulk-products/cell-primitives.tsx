"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

const fieldClass =
  "w-full rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-green-600 disabled:cursor-not-allowed disabled:bg-bg-dashboard disabled:text-gray-400";

export function GridTextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const { error, className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`${fieldClass} ${error ? "border-danger" : ""} ${className}`}
      // See FormInput's identical guard (packages/ui/src/Form.tsx) — a
      // number input must not silently change value on page-scroll.
      onWheel={
        rest.type === "number"
          ? (e) => {
              e.currentTarget.blur();
              rest.onWheel?.(e);
            }
          : rest.onWheel
      }
    />
  );
}

export function GridSelect({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={fieldClass}
    >
      {children}
    </select>
  );
}

/** A searchable single-select dropdown storing a stable id — Category/Subcategory/Brand/Manufacturer, per spec: "Store stable IDs internally instead of relying only on displayed names." */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "— Select —",
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(
    () => options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${fieldClass} flex items-center justify-between gap-1 text-left`}
      >
        <span className={`truncate ${!selected ? "text-gray-400" : ""}`}>
          {selected?.name ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div className="absolute left-0 top-[calc(100%+2px)] z-30 flex max-h-72 w-72 flex-col overflow-hidden rounded-md border border-border bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full text-sm outline-none"
            />
          </div>
          <div className="overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-bg-dashboard"
            >
              {placeholder}
            </button>
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`block w-full truncate px-3 py-2 text-left text-sm hover:bg-bg-dashboard ${
                  o.id === value ? "bg-green-50 font-semibold text-green-800" : "text-ink"
                }`}
              >
                {o.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-400">No matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Multi-select checklist popover with search, select-all, clear-all — Selected Attributes, Allowed Attribute Values, State Availability. */
export function ChecklistPopover({
  label,
  selectedIds,
  onChange,
  options,
  disabled,
  panIndiaMode,
}: {
  label: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
  /** State-availability's PAN INDIA / individual-state mutual exclusivity — empty selectedIds already means Pan India everywhere else in this codebase, this just controls the summary label. */
  panIndiaMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(
    () => options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  const summary =
    panIndiaMode && selectedIds.length === 0
      ? "PAN INDIA"
      : selectedIds.length === 0
        ? "— None —"
        : `${selectedIds.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${fieldClass} flex items-center justify-between gap-1 text-left`}
        title={label}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div className="absolute left-0 top-[calc(100%+2px)] z-30 flex max-h-80 w-72 flex-col overflow-hidden rounded-md border border-border bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full text-sm outline-none"
            />
          </div>
          {panIndiaMode && (
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
              className={`border-b border-border px-3 py-2 text-left text-sm font-bold hover:bg-bg-dashboard ${
                selectedIds.length === 0 ? "bg-green-50 text-green-800" : "text-ink"
              }`}
            >
              PAN INDIA (clears individual states)
            </button>
          )}
          <div className="flex gap-2 border-b border-border px-3 py-1.5 text-xs">
            <button
              type="button"
              className="font-semibold text-green-700 hover:underline"
              onClick={() => onChange(options.map((o) => o.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="font-semibold text-gray-500 hover:underline"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          </div>
          <div className="overflow-y-auto">
            {filtered.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-bg-dashboard"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  className="h-4 w-4 rounded border-border accent-green-600"
                />
                <span className="truncate">{o.name}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-400">No matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`flex max-h-[85vh] w-full flex-col rounded-lg bg-white shadow-2xl ${wide ? "max-w-4xl" : "max-w-xl"}`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-extrabold text-green-800">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-bg-dashboard hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
