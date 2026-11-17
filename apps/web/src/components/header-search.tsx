"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductCardData } from "@kisan4u/catalog";
import { searchProductSuggestions } from "@/lib/search-suggestions-action";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 220;

function priceLabel(pricing: ProductCardData["pricing"]): string | null {
  if (pricing.kind === "CUSTOMER" || pricing.kind === "DEALER_PRICED") {
    const price = pricing.minUnitPrice > 0 ? pricing.minUnitPrice : pricing.sellingPrice;
    return `₹${Math.round(price).toLocaleString("en-IN")}`;
  }
  return null;
}

/**
 * Header search — a controlled input with a live suggestions dropdown
 * (top 5 product matches, audience-aware via a server action). Enter, the
 * Search button, or "See all results" navigates to the catalogue results
 * page (`searchAction`), so the full result set is always reachable and
 * the native-form fallback behaviour is preserved. Dropdown pattern
 * mirrors the app's other floating menus (click-outside + Escape to
 * close, role="listbox"/"option", arrow-key navigation).
 */
export function HeaderSearch({
  searchAction,
  className = "",
}: {
  searchAction: string;
  className?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      searchProductSuggestions(trimmed)
        .then((rows) => {
          if (cancelled) return;
          setResults(rows);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmed]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function goToResults() {
    if (!trimmed) return;
    setOpen(false);
    router.push(`${searchAction}?q=${encodeURIComponent(trimmed)}`);
  }

  const showPanel = open && trimmed.length >= MIN_QUERY;
  // The "see all" row sits at index === results.length in the keyboard nav.
  const seeAllIndex = results.length;

  const panelBody = useMemo(() => {
    if (loading && results.length === 0) {
      return <div className="px-4 py-3 text-sm text-gray-500">Searching…</div>;
    }
    if (results.length === 0) {
      return <div className="px-4 py-3 text-sm text-gray-500">No matches for “{trimmed}”.</div>;
    }
    return (
      <ul role="listbox" aria-label="Search suggestions" id={listId}>
        {results.map((p, i) => {
          const price = priceLabel(p.pricing);
          return (
            <li key={p.id} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  setOpen(false);
                  router.push(p.href);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                  i === activeIndex ? "bg-green-50" : "hover:bg-gray-50"
                }`}
              >
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
                  {p.imageUrls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- no image optimizer configured
                    <img
                      src={p.imageUrls[0]}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                  {p.brandName ? (
                    <span className="block truncate text-xs text-gray-500">{p.brandName}</span>
                  ) : null}
                </span>
                {price ? (
                  <span className="shrink-0 text-sm font-semibold text-ink">{price}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }, [loading, results, trimmed, activeIndex, listId, router]);

  return (
    <div ref={rootRef} className={`relative flex w-full ${className}`}>
      <form
        role="search"
        className="flex w-full"
        onSubmit={(e) => {
          e.preventDefault();
          const active = activeIndex >= 0 ? results[activeIndex] : undefined;
          if (active) {
            setOpen(false);
            router.push(active.href);
            return;
          }
          goToResults();
        }}
      >
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showPanel) return;
            if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(seeAllIndex, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(-1, i - 1));
            }
          }}
          placeholder="Search for products, brands and more…"
          aria-label="Search products"
          aria-expanded={showPanel}
          aria-controls={listId}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-l-lg border-2 border-r-0 border-green-600 px-4 py-2.5 text-sm text-ink outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-r-lg border-2 border-green-600 bg-green-600 px-5 text-sm font-bold text-white transition-colors hover:bg-green-700"
        >
          Search
        </button>
      </form>

      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lift">
          {panelBody}
          {results.length > 0 ? (
            <button
              type="button"
              onMouseEnter={() => setActiveIndex(seeAllIndex)}
              onClick={goToResults}
              className={`block w-full border-t border-border px-4 py-2.5 text-left text-sm font-semibold text-green-700 ${
                activeIndex === seeAllIndex ? "bg-green-50" : "hover:bg-gray-50"
              }`}
            >
              See all results for “{trimmed}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
