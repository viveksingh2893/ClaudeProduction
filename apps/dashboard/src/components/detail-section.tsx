import Link from "next/link";

/**
 * Shared building blocks for account-detail pages (admin's customers/
 * dealers/sellers, and the admin/seller profile pages) — factored out of
 * the pattern apps/dashboard/src/app/admin/orders/[id]/page.tsx originated
 * (stacked `DetailSection`s + `KeyValue` rows, no tabs) so pages needing
 * the identical convention don't each redefine it. Lives under
 * components/ (not app/admin/) since seller/ pages use it too. `SimplePager`
 * is a plain `<Link>`-based prev/next control (no client JS) for a Server
 * Component section like "Orders" that needs its own page param without
 * turning the whole detail page into a Client Component.
 */

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-green-800">{title}</h2>
      {children}
    </section>
  );
}

export function KeyValue({
  label,
  value,
  emphasis,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={emphasis ? "font-bold text-ink" : "text-ink"}>{value}</span>
    </div>
  );
}

export function SimplePager({
  page,
  totalPages,
  paramKey,
  basePath,
}: {
  page: number;
  totalPages: number;
  /** Query-string key this section's page number lives under, e.g. "ordersPage" — kept distinct per section so multiple paginated sections on one page never collide. */
  paramKey: string;
  /** The detail page's own path, e.g. `/admin/customers/${id}` — pager links only ever change `paramKey`, nothing else in the URL. */
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-xs text-gray-600">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 && (
          <Link
            href={`${basePath}?${paramKey}=${page - 1}`}
            className="rounded-md border border-border px-2.5 py-1 font-semibold text-ink hover:border-green-600"
          >
            ‹ Previous
          </Link>
        )}
        {page < totalPages && (
          <Link
            href={`${basePath}?${paramKey}=${page + 1}`}
            className="rounded-md border border-border px-2.5 py-1 font-semibold text-ink hover:border-green-600"
          >
            Next ›
          </Link>
        )}
      </div>
    </div>
  );
}
