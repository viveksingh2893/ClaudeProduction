"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A minimal debounced async-search dropdown — no such component exists
 * anywhere in this codebase yet (checked packages/ui), and POS needs it
 * twice (customer search spec §5, dealer search spec §7), so it's built
 * once here rather than duplicated. Debounces the query (300ms) and lets
 * `fetchOptions` run the actual server search — callers pass a POS server
 * action, which re-checks permission/role/status server-side regardless
 * of anything typed here (this component only ever renders what the
 * server returned).
 */
export function Combobox<T>({
  placeholder,
  fetchOptions,
  renderOption,
  getKey,
  onSelect,
  minChars = 2,
}: {
  placeholder: string;
  fetchOptions: (query: string) => Promise<T[]>;
  renderOption: (option: T) => React.ReactNode;
  getKey: (option: T) => string;
  onSelect: (option: T) => void;
  minChars?: number;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < minChars) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const results = await fetchOptions(query.trim());
      if (requestId.current === id) {
        setOptions(results);
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchOptions is expected to be stable per mount (a bound server action reference)
  }, [query, minChars]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-lg border-[1.5px] border-border bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-gray-400 focus:border-green-600 focus:outline-none"
      />
      {open && query.trim().length >= minChars && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-card">
          {loading && <div className="px-3.5 py-3 text-sm text-gray-500">Searching…</div>}
          {!loading && options.length === 0 && (
            <div className="px-3.5 py-3 text-sm text-gray-500">No matches found.</div>
          )}
          {!loading &&
            options.map((option) => (
              <button
                key={getKey(option)}
                type="button"
                onClick={() => {
                  onSelect(option);
                  setOpen(false);
                  setQuery("");
                }}
                className="block w-full border-b border-border px-3.5 py-2.5 text-left text-sm last:border-b-0 hover:bg-green-50"
              >
                {renderOption(option)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
