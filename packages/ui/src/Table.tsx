import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, ImageOff } from "lucide-react";
import { TableScrollArea } from "./TableScrollArea";

/**
 * Shared admin data-table primitives — deliberately state-free (same
 * convention as Card/Badge/Button) so they render from Server or Client
 * Components alike. Interactive behavior (sorting, pagination, row menus)
 * lives in DataTable.tsx / RowActionMenu.tsx, the documented "use client"
 * exceptions; this file is just the visual/structural building blocks those
 * (and any bespoke table) compose.
 */

export function TableShell({
  children,
  className = "",
  toolbar,
}: {
  children: ReactNode;
  className?: string;
  toolbar?: ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border bg-surface shadow-card ${className}`}
    >
      {toolbar}
      <TableScrollArea>{children}</TableScrollArea>
    </div>
  );
}

export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={`w-full min-w-[640px] border-collapse text-sm ${className}`} {...props} />
  );
}

/** Sticks to the top of the page as the surrounding content scrolls — safe because the admin shell scrolls the document, not a clipped inner container. */
export function TableHead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={`sticky top-0 z-10 bg-green-50/95 backdrop-blur-sm ${className}`}
      {...props}
    />
  );
}

export type SortDirection = "asc" | "desc" | null;

export function TableHeaderCell({
  align = "left",
  sortable,
  sortDirection = null,
  onSort,
  className = "",
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortDirection?: SortDirection;
  onSort?: () => void;
}) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const Icon =
    sortDirection === "asc" ? ChevronUp : sortDirection === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={
        sortable
          ? sortDirection === "asc"
            ? "ascending"
            : sortDirection === "desc"
              ? "descending"
              : "none"
          : undefined
      }
      className={`whitespace-nowrap border-b border-border px-4 py-3 text-[11.5px] font-bold uppercase tracking-wide text-green-800 ${alignClass} ${className}`}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={`inline-flex items-center gap-1 hover:text-green-900 ${align === "right" ? "flex-row-reverse" : ""}`}
        >
          {children}
          <Icon
            className={`h-3.5 w-3.5 ${sortDirection ? "text-green-700" : "text-gray-400"}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TableBody({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`divide-y divide-border ${className}`} {...props} />;
}

export function TableRow({
  className = "",
  selected,
  interactive,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; interactive?: boolean }) {
  return (
    <tr
      className={`transition-colors ${selected ? "bg-green-50" : "odd:bg-transparent even:bg-bg-dashboard/40"} ${
        interactive ? "cursor-pointer hover:bg-green-50" : "hover:bg-green-50/70"
      } ${className}`}
      {...props}
    />
  );
}

export function TableCell({
  align = "left",
  truncate,
  className = "",
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right" | "center";
  truncate?: boolean;
}) {
  const alignClass =
    align === "right"
      ? "text-right tabular-nums"
      : align === "center"
        ? "text-center"
        : "text-left";
  return (
    <td
      className={`px-4 py-3 align-middle text-[13.5px] text-ink ${alignClass} ${className}`}
      {...props}
    >
      {truncate ? <span className="block max-w-[220px] truncate">{children}</span> : children}
    </td>
  );
}

/** Text that's too long for a cell — visually truncated, full value on hover/focus via native title, so the tooltip is a convenience and not the only way to read it (the value is still in the DOM for copy/search). */
export function Truncate({
  value,
  maxWidth = "220px",
  className = "",
}: {
  value: string;
  maxWidth?: string;
  className?: string;
}) {
  return (
    <span title={value} className={`block truncate ${className}`} style={{ maxWidth }}>
      {value}
    </span>
  );
}

/** Fixed-size image/avatar cell with a safe fallback when no src is given — used for product/category thumbnails and seller/user identity rows. */
export function Thumbnail({
  src,
  alt,
  size = "md",
  shape = "square",
  className = "",
}: {
  src?: string | null;
  alt: string;
  size?: "sm" | "md" | "lg";
  shape?: "square" | "circle";
  className?: string;
}) {
  const sizeClass = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-md";
  if (!src) {
    return (
      <div
        className={`flex ${sizeClass} shrink-0 items-center justify-center ${shapeClass} border border-border bg-bg-dashboard text-gray-400 ${className}`}
        aria-hidden="true"
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- this codebase renders uploaded/pasted image URLs as plain <img> everywhere, see banner-carousel.tsx's doc comment
    <img
      src={src}
      alt={alt}
      className={`${sizeClass} shrink-0 ${shapeClass} border border-border object-cover ${className}`}
    />
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
  ).toUpperCase();
}

/** Name + secondary line (email/phone/shop) with an avatar — the standard "who is this row about" cell for users, sellers, dealers, customers. */
export function IdentityCell({
  name,
  subtitle,
  avatarUrl,
}: {
  name: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatarUrl ? (
        <Thumbnail src={avatarUrl} alt="" shape="circle" size="sm" />
      ) : (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-[11px] font-bold text-green-800"
          aria-hidden="true"
        >
          {initials(name) || "?"}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-ink">{name}</div>
        {subtitle && <div className="truncate text-xs text-gray-600">{subtitle}</div>}
      </div>
    </div>
  );
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN");
}

export function formatDate(value: Date | string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Card-styled row list for admin screens that are conceptually a table
 * (one card per record, consistent actions) but whose rows carry bespoke
 * inline content — thumbnails, inline edit forms, per-row Save buttons —
 * that don't fit a fixed column grid. Used instead of forcing e.g. the
 * banner/homepage-section managers into <table> markup they don't suit.
 */
export function RecordList({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function RecordListRow({
  children,
  className = "",
  selected,
}: {
  children: ReactNode;
  className?: string;
  selected?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors ${selected ? "bg-green-50" : "hover:bg-green-50/70"} ${className}`}
    >
      {children}
    </div>
  );
}
