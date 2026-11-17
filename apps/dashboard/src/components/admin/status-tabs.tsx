import Link from "next/link";

export type StatusTabItem = {
  key: string;
  label: string;
  count?: number;
  /** Full href including any other query params the page needs to preserve. */
  href: string;
};

/**
 * Query-param-driven segment tabs ("All / Approved / Pending / …") used
 * across the redesigned admin directories. Server-rendered — each tab is
 * a plain link so the active segment survives reload/back-forward, same
 * as the rest of the table's URL-driven state.
 */
export function StatusTabs({ items, activeKey }: { items: StatusTabItem[]; activeKey: string }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200">
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              active
                ? "border-green-700 text-green-700"
                : "border-transparent text-gray-500 hover:text-ink"
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${
                  active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
