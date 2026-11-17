"use client";

import { useMemo, useState } from "react";
import { AnchorButton, Card } from "@kisan4u/ui";
import { Download } from "lucide-react";
import { CalendarDateField } from "@/components/calendar-date-field";

/** Local calendar date (admin works in IST) as `YYYY-MM-DD`. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29); // last 30 days, inclusive of today
  return { from: toISODate(from), to: toISODate(to) };
}

type ReportDef = {
  key: string;
  title: string;
  blurb: string;
  path: string;
};

const REPORTS: ReportDef[] = [
  {
    key: "orders",
    title: "Order Report",
    blurb: "One row per order — customer, seller, invoice, status, totals, remark.",
    path: "/api/admin/reports/orders",
  },
  {
    key: "product-wise",
    title: "Product Wise Report",
    blurb: "One row per product line — SKU, HSN, price, qty, GST, line total.",
    path: "/api/admin/reports/product-wise",
  },
];

export function ReportsDownloadForm() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const rangeError = !from || !to ? "Pick both a start and end date." : from > to ? "Start date is after end date." : null;
  const query = new URLSearchParams({ from, to }).toString();

  return (
    <Card className="max-w-2xl p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CalendarDateField label="From" value={from} max={to || undefined} onChange={setFrom} />
        <CalendarDateField label="To" value={to} min={from || undefined} onChange={setTo} />
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Filters on order date (IST), both ends inclusive. Every order in the range is included,
        regardless of status.
      </p>

      {rangeError && <p className="mt-2 text-xs font-medium text-danger">{rangeError}</p>}

      <div className="mt-5 flex flex-col gap-3">
        {REPORTS.map((r) => (
          <div
            key={r.key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-dashboard px-4 py-3"
          >
            <div>
              <div className="text-sm font-bold text-ink">{r.title}</div>
              <div className="text-xs text-gray-500">{r.blurb}</div>
            </div>
            {rangeError ? (
              <span
                aria-disabled="true"
                className="pointer-events-none inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-400"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download .xlsx
              </span>
            ) : (
              <AnchorButton href={`${r.path}?${query}`} variant="outline" size="sm" download>
                <Download className="h-4 w-4" aria-hidden="true" />
                Download .xlsx
              </AnchorButton>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
