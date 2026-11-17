"use client";

/**
 * Deliberate "use client" exception (same reasoning as Modal/Carousel/
 * ScrollRow): a generic table needs interactive search/sort/pagination
 * state, so that state has to live somewhere. `AdminDataTable` owns it so
 * every admin page gets the same behavior for free instead of re-deriving
 * useState+useMemo search/sort/paging logic per page.
 *
 * Two modes, one component (per the redesign brief: "update the existing
 * shared table module instead of creating a second conflicting table
 * system"):
 *
 * - Client mode (default, `server` prop omitted) — `data` is the table's
 *   entire result set; search/sort/pagination all run in memory here.
 *   Reserved for genuinely small, not-independently-growing reference
 *   lists (categories, attributes, brands, ...) — see the redesign
 *   report for the documented list and reasoning.
 * - Server mode (`server` prop present) — `data` is already just the
 *   current page, fetched by the caller's Server Component page with a
 *   real Prisma `where`/`orderBy`/`skip`/`take` + a separate count query.
 *   This component never re-filters/re-sorts/re-slices `data` itself in
 *   that mode; every control (search box, sort header, page/page-size
 *   change) instead calls back into `server`'s callbacks, which the
 *   caller wires to `useAdminTableUrlState` (see useTableUrlState.ts) so
 *   the query lives in the URL — reload, back/forward, and "open a
 *   record then come back" all restore it for free.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "./Button";
import { EmptyState, LoadingState, AlertBox } from "./Feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
  type SortDirection,
} from "./Table";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Plain-text accessor used by the built-in (client-mode) search box and default sort comparator. Ignored in server mode — search/sort happen in the database instead. Omit for columns that are actions-only or purely visual. */
  value?: (row: T) => string | number | Date | null | undefined;
  /** In server mode, this is also the value sent to `server.onSortChange` — must match a column your query's whitelist actually knows how to `orderBy`. */
  sortable?: boolean;
  align?: "left" | "right" | "center";
  truncate?: boolean;
  headerClassName?: string;
  cellClassName?: string;
  /** Hide this column on the desktop table below the given breakpoint; it still appears in the mobile card view unless `mobileHidden` is also set. */
  hideBelow?: "md" | "lg";
  /** Used as the mobile-card title (first `primary` column wins); other columns render as label/value rows underneath. */
  primary?: boolean;
  mobileHidden?: boolean;
};

/** Everything a server-paginated table needs the caller to control — see useAdminTableUrlState, which produces most of this directly. */
export type ServerTableState = {
  totalItems: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  sortKey: string | null;
  sortDir: SortDirection;
  onSortChange: (key: string | null, dir: SortDirection) => void;
};

export type AdminDataTableProps<T> = {
  data: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  /** Renders the row's action buttons/menu — same content is used in the desktop row and the mobile card. */
  renderActions?: (row: T) => ReactNode;
  caption: string;
  searchPlaceholder?: string;
  /** Hides the built-in search box entirely — for the rare page with no meaningful search field at all. In server mode, prefer `server.searchValue`/`onSearchChange` over this. */
  hideSearch?: boolean;
  /** Switches this table into server-driven pagination/sort/search — see the file-level doc comment. */
  server?: ServerTableState;
  /** Extra filter controls the caller already implements (TableFilterSelect/TableFilterDateRange, a server-driven GET form, etc.) — rendered in the toolbar next to search. */
  filters?: ReactNode;
  /** True when any filter control in `filters` currently has a non-default value (e.g. `useActiveFilterCount(keys) > 0`) — lets an empty result set say "no matches for your filters" instead of "no records exist yet." */
  hasActiveFilters?: boolean;
  /** Rendered next to the filters when a non-default filter is active — usually ActiveFilterSummary or a "Clear" Link the caller already owns. */
  clearFiltersAction?: ReactNode;
  toolbarActions?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  onRowClick?: (row: T) => void;
  /** Extra class names applied to this row's desktop `<tr>` and mobile card — e.g. a tinted background for a stock-status row. Composed alongside TableRow's own odd/even/hover classes, never replacing them. */
  rowClassName?: (row: T) => string;
  className?: string;
};

export function AdminDataTable<T>({
  data,
  columns,
  rowKey,
  renderActions,
  caption,
  searchPlaceholder = "Search…",
  hideSearch,
  server,
  filters,
  hasActiveFilters = false,
  clearFiltersAction,
  toolbarActions,
  emptyTitle = "No records found",
  emptyDescription,
  emptyIcon,
  emptyAction,
  isLoading,
  errorMessage,
  onRetry,
  pageSizeOptions = [20, 50, 100],
  defaultPageSize = 20,
  onRowClick,
  rowClassName,
  className = "",
}: AdminDataTableProps<T>) {
  const isServer = !!server;

  const [clientSearch, setClientSearch] = useState("");
  const [clientSortKey, setClientSortKey] = useState<string | null>(null);
  const [clientSortDir, setClientSortDir] = useState<SortDirection>(null);
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(defaultPageSize);

  const clientSearched = useMemo(() => {
    if (isServer) return data;
    const q = clientSearch.trim().toLowerCase();
    if (!q) return data;
    const searchableCols = columns.filter((c) => c.value);
    return data.filter((row) =>
      searchableCols.some((c) =>
        String(c.value!(row) ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [isServer, data, clientSearch, columns]);

  const clientSorted = useMemo(() => {
    if (isServer) return clientSearched;
    if (!clientSortKey || !clientSortDir) return clientSearched;
    const col = columns.find((c) => c.key === clientSortKey);
    if (!col?.value) return clientSearched;
    const copy = [...clientSearched];
    copy.sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        av instanceof Date || bv instanceof Date
          ? +new Date(av) - +new Date(bv)
          : av > bv
            ? 1
            : av < bv
              ? -1
              : 0;
      return clientSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [isServer, clientSearched, clientSortKey, clientSortDir, columns]);

  // Unify the two modes into one set of values the rest of the render
  // logic uses, so the JSX below never has to branch on `isServer`.
  const sortKey = isServer ? server!.sortKey : clientSortKey;
  const sortDir = isServer ? server!.sortDir : clientSortDir;
  const page = isServer ? server!.page : clientPage;
  const pageSize = isServer ? server!.pageSize : clientPageSize;
  const totalItems = isServer ? server!.totalItems : clientSorted.length;
  const searchValue = isServer ? server!.searchValue : clientSearch;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const paged = useMemo(() => {
    if (isServer) return data;
    return clientSorted.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);
  }, [isServer, data, clientSorted, clampedPage, pageSize]);

  function handleSearchChange(value: string) {
    if (isServer) {
      server!.onSearchChange(value);
    } else {
      setClientSearch(value);
      setClientPage(1);
    }
  }
  function handleSearchSubmit() {
    if (isServer) server!.onSearchSubmit?.();
  }
  function handleSort(key: string) {
    if (isServer) {
      const nextDir: SortDirection =
        sortKey !== key ? "asc" : sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc";
      server!.onSortChange(nextDir ? key : null, nextDir);
      return;
    }
    if (clientSortKey !== key) {
      setClientSortKey(key);
      setClientSortDir("asc");
    } else if (clientSortDir === "asc") {
      setClientSortDir("desc");
    } else {
      setClientSortKey(null);
      setClientSortDir(null);
    }
    setClientPage(1);
  }
  function handlePageChange(next: number) {
    if (isServer) server!.onPageChange(next);
    else setClientPage(next);
  }
  function handlePageSizeChange(size: number) {
    if (isServer) server!.onPageSizeChange(size);
    else {
      setClientPageSize(size);
      setClientPage(1);
    }
  }

  const visibleColumns = columns.filter((c) => !c.mobileHidden || !c.hideBelow);
  const primaryCol = columns.find((c) => c.primary) ?? columns[0];
  const secondaryCols = columns.filter((c) => c !== primaryCol);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
      {!hideSearch && (
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearchSubmit();
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full rounded-md border-[1.5px] border-border py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors focus:border-green-600"
          />
        </div>
      )}
      {filters && (
        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal
            className="hidden h-4 w-4 shrink-0 text-gray-400 md:block"
            aria-hidden="true"
          />
          {filters}
        </div>
      )}
      {clearFiltersAction}
      <span className="text-xs font-medium text-gray-600" role="status" aria-live="polite">
        {totalItems} {totalItems === 1 ? "result" : "results"}
      </span>
      {toolbarActions && <div className="ml-auto flex items-center gap-2">{toolbarActions}</div>}
    </div>
  );

  if (errorMessage) {
    return (
      <TableShell className={className} toolbar={toolbar}>
        <div className="p-6">
          <AlertBox tone="danger" title="Couldn't load this data">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{errorMessage}</span>
              {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )}
            </div>
          </AlertBox>
        </div>
      </TableShell>
    );
  }

  if (isLoading) {
    return (
      <TableShell className={className} toolbar={toolbar}>
        <LoadingState label="Loading…" />
      </TableShell>
    );
  }

  const hasQuery = isServer ? !!server!.searchValue || hasActiveFilters : !!clientSearch;
  const nothingAtAll = totalItems === 0 && !hasQuery;

  if (nothingAtAll) {
    return (
      <TableShell className={className} toolbar={filters || toolbarActions ? toolbar : undefined}>
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      </TableShell>
    );
  }

  return (
    <TableShell className={className} toolbar={toolbar}>
      {paged.length === 0 ? (
        <EmptyState
          title="No matches"
          description="Nothing matches your search and filters. Try a different term or clear filters."
          action={
            clearFiltersAction ? undefined : (
              <Button variant="outline" size="sm" onClick={() => handleSearchChange("")}>
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Desktop / tablet: real <table> markup for semantics + screen-reader table navigation. */}
          <div className="hidden md:block">
            <Table>
              <caption className="sr-only">{caption}</caption>
              <TableHead>
                <tr>
                  {visibleColumns.map((col) => (
                    <TableHeaderCell
                      key={col.key}
                      align={col.align}
                      sortable={col.sortable}
                      sortDirection={sortKey === col.key ? sortDir : null}
                      onSort={col.sortable ? () => handleSort(col.key) : undefined}
                      className={`${col.headerClassName ?? ""} ${col.hideBelow === "lg" ? "hidden lg:table-cell" : ""}`}
                    >
                      {col.header}
                    </TableHeaderCell>
                  ))}
                  {renderActions && (
                    <th
                      scope="col"
                      className="border-b border-border px-4 py-3 text-right text-[11.5px] font-bold uppercase tracking-wide text-green-800"
                    >
                      Actions
                    </th>
                  )}
                </tr>
              </TableHead>
              <TableBody>
                {paged.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    className={rowClassName?.(row) ?? ""}
                    interactive={!!onRowClick}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    role={onRowClick ? "link" : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                  >
                    {visibleColumns.map((col) => (
                      <TableCell
                        key={col.key}
                        align={col.align}
                        truncate={col.truncate}
                        className={`${col.cellClassName ?? ""} ${col.hideBelow === "lg" ? "hidden lg:table-cell" : ""}`}
                      >
                        {col.render(row)}
                      </TableCell>
                    ))}
                    {renderActions && (
                      <TableCell
                        align="right"
                        className="whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {renderActions(row)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: one card per record instead of squeezing a wide table into a narrow viewport. */}
          <ul className="divide-y divide-border md:hidden">
            {paged.map((row) => (
              <li
                key={rowKey(row)}
                className={`flex flex-col gap-2 px-4 py-3.5 ${onRowClick ? "cursor-pointer hover:bg-green-50" : ""} ${rowClassName?.(row) ?? ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "link" : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-sm font-semibold text-ink">
                    {primaryCol?.render(row)}
                  </div>
                  {renderActions && (
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {renderActions(row)}
                    </div>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {secondaryCols
                    .filter((c) => !c.mobileHidden)
                    .map((col) => (
                      <div key={col.key} className="min-w-0">
                        <dt className="font-semibold uppercase tracking-wide text-gray-400">
                          {col.header}
                        </dt>
                        <dd className="truncate text-ink">{col.render(row)}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>

          <Pagination
            page={clampedPage}
            totalPages={totalPages}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            totalItems={totalItems}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}
    </TableShell>
  );
}

/** Compact windowed page-number list: first, last, current ± 1, with an ellipsis for any gap — never more than ~7 buttons regardless of totalPages. */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
}

export function Pagination({
  page,
  totalPages,
  pageSize,
  totalItems,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);
  const showPageControls = totalPages > 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-gray-600">
      <span role="status" aria-live="polite">
        Showing{" "}
        <span className="font-semibold text-ink">
          {start}–{end}
        </span>{" "}
        of <span className="font-semibold text-ink">{totalItems}</span>
        {totalPages > 1 && (
          <span className="ml-1 text-gray-400">
            (page {page} of {totalPages})
          </span>
        )}
      </span>
      <div className="flex items-center gap-4">
        {onPageSizeChange && pageSizeOptions && (
          <label className="flex items-center gap-1.5">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
              className="rounded-md border border-border bg-white px-2 py-1 text-xs text-ink outline-none focus:border-green-600"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {showPageControls && (
          <nav className="flex items-center gap-1" aria-label="Pagination">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              ‹
            </Button>
            {pageWindow(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={`ellipsis-${i}`} className="px-1 text-gray-400">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? "page" : undefined}
                  className={`flex h-8 min-w-[2rem] items-center justify-center rounded-md px-1.5 font-semibold transition-colors ${
                    p === page ? "bg-green-700 text-white" : "text-ink hover:bg-green-50"
                  }`}
                >
                  {p}
                </button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              ›
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}

/** Skeleton rows for the rare case a table's data genuinely loads after first paint (e.g. a route `loading.tsx`). Most admin tables fetch server-side before render and never show this. */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <TableShell>
      <div className="hidden md:block">
        <Table>
          <TableBody>
            {Array.from({ length: rows }).map((_, r) => (
              <TableRow key={r}>
                {Array.from({ length: columns }).map((_, c) => (
                  <TableCell key={c}>
                    <div
                      className="h-3.5 animate-pulse rounded bg-border"
                      style={{ width: `${55 + ((r + c) % 4) * 10}%` }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 p-4 md:hidden">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="h-14 animate-pulse rounded-lg bg-border/70" />
        ))}
      </div>
    </TableShell>
  );
}
