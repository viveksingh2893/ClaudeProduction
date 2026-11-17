"use client";

import { useRouter } from "next/navigation";
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableShell,
  formatCurrency,
} from "@kisan4u/ui";
import { Download } from "lucide-react";
import type { SettlementCycleSellerRow, SettlementCycleRollupStatus } from "@kisan4u/orders";
import { MarkCycleSettledButton } from "./mark-settled-button";

const ROLLUP: Record<
  SettlementCycleRollupStatus,
  { label: string; tone: "success" | "warning" | "neutral" | "danger" | "info" }
> = {
  PAID: { label: "Paid", tone: "info" },
  READY: { label: "Ready to pay", tone: "success" },
  PARTIAL: { label: "Partly paid", tone: "warning" },
  ACCRUING: { label: "Accruing", tone: "warning" },
  REVIEW: { label: "Needs review", tone: "danger" },
  EMPTY: { label: "Reversed", tone: "neutral" },
};

/**
 * The slim per-seller list for one payout cycle. Only the columns an admin
 * needs to decide a payout — seller, what they're owed, Kisan4U's cut, the
 * cycle it belongs to, status, and the two actions. Clicking a row opens
 * that seller's full settlement breakdown for this cycle only.
 */
export function CycleSellersTable({
  payoutKey,
  payoutLabel,
  windowLabel,
  payoutReached,
  sellers,
}: {
  payoutKey: string;
  payoutLabel: string;
  windowLabel: string;
  /** false until the cycle's payout date (9th/19th/29th) — "Mark paid" stays locked until then. */
  payoutReached: boolean;
  sellers: SettlementCycleSellerRow[];
}) {
  const router = useRouter();

  return (
    <TableShell>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Seller</TableHeaderCell>
            <TableHeaderCell align="right">Amount due</TableHeaderCell>
            <TableHeaderCell align="right">Kisan4U commission</TableHeaderCell>
            <TableHeaderCell>Cycle</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell align="right">Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sellers.map((s) => {
            const rollup = ROLLUP[s.rollupStatus];
            const href = `/admin/settlements/${payoutKey}/${s.sellerId}`;
            return (
              <TableRow key={s.sellerId} interactive onClick={() => router.push(href)}>
                <TableCell className="font-semibold text-ink">{s.shopName}</TableCell>
                <TableCell align="right" className="font-bold text-ink">
                  {formatCurrency(s.netPayable)}
                </TableCell>
                <TableCell align="right">{formatCurrency(s.commission)}</TableCell>
                <TableCell>
                  <span className="font-medium text-ink">{payoutLabel}</span>
                  <span className="block text-[11px] text-gray-500">{windowLabel}</span>
                </TableCell>
                <TableCell>
                  <Badge tone={rollup.tone}>{rollup.label}</Badge>
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-2">
                    <a
                      href={`/api/admin/sellers/${s.sellerId}/settlements/export?cycle=${payoutKey}`}
                      className="inline-flex items-center gap-1 rounded-md border-[1.5px] border-border px-2.5 py-1 text-xs font-semibold text-ink hover:bg-bg-dashboard"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Excel
                    </a>
                    <MarkCycleSettledButton
                      payoutKey={payoutKey}
                      sellerId={s.sellerId}
                      disabled={!s.readyToSettle}
                      notYetPayableLabel={payoutReached ? undefined : payoutLabel}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableShell>
  );
}
