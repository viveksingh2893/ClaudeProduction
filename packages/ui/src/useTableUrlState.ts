"use client";

/**
 * "use client" exception, same family as DataTable/RowActionMenu — table
 * state (page/pageSize/sort/search/filters) is synced to the URL so it
 * survives a reload, a browser back/forward, and "open a record then come
 * back." Next.js's own router is the only thing that can read/write
 * searchParams, so this has to be a hook, not a state-free primitive.
 *
 * Deliberately NOT tied to AdminDataTable — `useAdminTableUrlState` covers
 * the standardized page/pageSize/sort/search slice a server-paginated
 * table needs, while `useUrlFilterParam` is the single-param building
 * block bespoke filter controls (a status <select>, a date-range pair)
 * use to sync their own query param the same way, without each table
 * reinventing URLSearchParams plumbing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function buildParams(
  current: URLSearchParams,
  patch: Record<string, string | number | null | undefined>,
) {
  const params = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  return params;
}

export type SortDir = "asc" | "desc" | null;

export type AdminTableUrlState = {
  page: number;
  pageSize: number;
  sortKey: string | null;
  sortDir: SortDir;
  /** Committed (URL) search value — what the Server Component's query actually used. */
  search: string;
  /** Live input value — updates every keystroke; diverges from `search` until the debounce commits. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  /** Commits `searchInput` immediately (Enter key), skipping the debounce. */
  submitSearch: () => void;
  clearSearch: () => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSort: (key: string | null, dir: SortDir) => void;
};

/**
 * The standardized page/pageSize/sort/search slice of table URL state.
 * Filter params are handled separately (see `useUrlFilterParam`) since
 * each table's filter set is genuinely different — this hook only owns
 * the part every server-paginated table has in common.
 */
export function useAdminTableUrlState({
  defaultPageSize = 20,
  searchDebounceMs = 400,
}: {
  defaultPageSize?: number;
  searchDebounceMs?: number;
} = {}): AdminTableUrlState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize =
    Number(searchParams.get("pageSize") ?? String(defaultPageSize)) || defaultPageSize;
  const sortKey = searchParams.get("sort");
  const sortDirParam = searchParams.get("dir");
  const sortDir: SortDir = sortDirParam === "asc" || sortDirParam === "desc" ? sortDirParam : null;
  const search = searchParams.get("q") ?? "";

  const [searchInput, setSearchInputState] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only re-sync from the URL when the browser itself changed it (back/
  // forward, a Link navigation) — not on every render, so typing doesn't
  // get clobbered by the debounce timer's own pending commit.
  const lastCommitted = useRef(search);
  useEffect(() => {
    if (search !== lastCommitted.current) {
      setSearchInputState(search);
      lastCommitted.current = search;
    }
  }, [search]);

  const commit = useCallback(
    (
      patch: Record<string, string | number | null | undefined>,
      opts: { resetPage?: boolean; replace?: boolean } = {},
    ) => {
      const { resetPage = true, replace = false } = opts;
      const params = buildParams(searchParams, resetPage ? { ...patch, page: null } : patch);
      const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setPage = useCallback(
    (next: number) => commit({ page: next === 1 ? null : next }, { resetPage: false }),
    [commit],
  );
  const setPageSize = useCallback(
    (size: number) => commit({ pageSize: size === defaultPageSize ? null : size }),
    [commit, defaultPageSize],
  );
  const setSort = useCallback(
    (key: string | null, dir: SortDir) => commit({ sort: key, dir }),
    [commit],
  );

  const setSearchInput = useCallback(
    (value: string) => {
      setSearchInputState(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        lastCommitted.current = value;
        commit({ q: value }, { replace: true });
      }, searchDebounceMs);
    },
    [commit, searchDebounceMs],
  );

  const submitSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    lastCommitted.current = searchInput;
    commit({ q: searchInput }, { replace: true });
  }, [commit, searchInput]);

  const clearSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInputState("");
    lastCommitted.current = "";
    commit({ q: null });
  }, [commit]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return {
    page,
    pageSize,
    sortKey,
    sortDir,
    search,
    searchInput,
    setSearchInput,
    submitSearch,
    clearSearch,
    setPage,
    setPageSize,
    setSort,
  };
}

/**
 * Single-query-param sync for a bespoke filter control (a status
 * <select>, one end of a date range, ...) — every write resets `page` to
 * keep pagination valid, matching the same rule AdminDataTable's own
 * search/sort/pageSize changes follow.
 */
export function useUrlFilterParam(key: string): [string, (value: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(key) ?? "";

  const setValue = useCallback(
    (next: string | null) => {
      const params = buildParams(searchParams, { [key]: next, page: null });
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname, {
        scroll: false,
      });
    },
    [key, pathname, router, searchParams],
  );

  return [value, setValue];
}

/** Clears every listed filter key (plus `q` and `page`) in one navigation — the "Clear all filters" action. */
export function useClearUrlFilters(keys: string[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useCallback(() => {
    const patch: Record<string, null> = { q: null, page: null };
    for (const key of keys) patch[key] = null;
    const params = buildParams(searchParams, patch);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname, {
      scroll: false,
    });
  }, [keys, pathname, router, searchParams]);
}

/** Count of currently-active (non-empty) filter params, for a toolbar's "3 filters active" badge. */
export function useActiveFilterCount(keys: string[]): number {
  const searchParams = useSearchParams();
  return keys.filter((key) => !!searchParams.get(key)).length;
}
