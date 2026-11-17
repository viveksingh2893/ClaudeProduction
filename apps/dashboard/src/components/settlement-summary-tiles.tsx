import { Card, formatCurrency } from "@kisan4u/ui";
import type { SerializedSettlementSummary } from "@/lib/settlement-view";

const TILES: { key: keyof SerializedSettlementSummary; label: string; tone?: "danger" }[] = [
  { key: "totalSales", label: "Total sales" },
  { key: "totalDeductions", label: "Total deductions" },
  { key: "totalPayable", label: "Payable (net)" },
  { key: "settledAmount", label: "Settled" },
  { key: "pendingEligibleAmount", label: "Pending / eligible" },
  { key: "reversedAdjustedAmount", label: "Reversed / adjusted", tone: "danger" },
];

/** Six summary tiles required for both the seller Settlement page and the admin seller-detail Settlements section — reads the same SettlementSummary shape either way. */
export function SettlementSummaryTiles({ summary }: { summary: SerializedSettlementSummary }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {TILES.map((tile) => {
        const value = summary[tile.key] as number;
        return (
          <Card key={tile.key} className="p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{tile.label}</div>
            <div className={`mt-1 text-lg font-extrabold ${tile.tone === "danger" && value !== 0 ? "text-danger" : "text-ink"}`}>
              {formatCurrency(value)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
