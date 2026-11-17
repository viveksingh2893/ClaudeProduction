"use client";

import { Search } from "lucide-react";
import {
  ActiveFilterSummary,
  FilterDrawer,
  TableFilterDateRange,
  TableFilterSelect,
  useActiveFilterCount,
  useAdminTableUrlState,
  useClearUrlFilters,
} from "@kisan4u/ui";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/order-status-labels";

const FILTER_KEYS = ["status", "paymentMethod", "dateFrom", "dateTo"];

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));
const PAYMENT_OPTIONS = Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/** Search + status/payment/date filters for POS Orders — separate from the quick status tabs (server-rendered links) since these are free-form and narrow within whichever tab is active. */
export function PosOrdersFilterBar() {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  const activeFilterCount = useActiveFilterCount(FILTER_KEYS);
  const clearAllFilters = useClearUrlFilters(FILTER_KEYS);

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={table.searchInput}
            onChange={(e) => table.setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && table.submitSearch()}
            placeholder="Search order #, buyer name, or phone…"
            aria-label="Search POS orders"
            className="w-full rounded-md border-[1.5px] border-border bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors focus:border-green-600"
          />
        </div>
        <ActiveFilterSummary count={activeFilterCount} onClear={clearAllFilters} />
      </div>
      <FilterDrawer count={activeFilterCount}>
        <TableFilterSelect paramKey="status" label="Any status" options={STATUS_OPTIONS} />
        <TableFilterSelect
          paramKey="paymentMethod"
          label="Any payment method"
          options={PAYMENT_OPTIONS}
        />
        <TableFilterDateRange fromParamKey="dateFrom" toParamKey="dateTo" label="Placed" />
      </FilterDrawer>
    </div>
  );
}
