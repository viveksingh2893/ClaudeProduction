"use client";

import { Search } from "lucide-react";
import { useAdminTableUrlState } from "@kisan4u/ui";

export function PaymentVerificationSearchBar() {
  const table = useAdminTableUrlState({ defaultPageSize: 20 });
  return (
    <div className="relative max-w-sm">
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
        aria-label="Search payment proofs"
        className="w-full rounded-md border-[1.5px] border-border bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors focus:border-green-600"
      />
    </div>
  );
}
