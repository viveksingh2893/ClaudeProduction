"use client";

import { SettlementsTable } from "@/components/settlements-table";
import type { CommissionRow } from "@/lib/settlement-view";
import { SettlementRowActions } from "./settlement-actions";

/**
 * A Server Component (page.tsx) cannot pass a plain render-prop function
 * like `renderActions` to a Client Component (SettlementsTable) — only a
 * "use server" Server Action can cross that boundary. This thin Client
 * Component wrapper receives the already-serializable row data instead,
 * and builds `renderActions` itself, entirely client-side.
 */
export function AdminSettlementsSection({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: CommissionRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  return (
    <SettlementsTable
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      // No settlement row yet (order not DELIVERED) -> nothing to settle or
      // reverse for this order item.
      renderActions={(row) =>
        row.settlementId ? (
          <SettlementRowActions settlementId={row.settlementId} status={row.transactionStatus} />
        ) : null
      }
      emptyDescription="This seller's order items appear here as soon as they're placed — the financial breakdown fills in once each item is delivered."
    />
  );
}
