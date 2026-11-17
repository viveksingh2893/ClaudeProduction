import { redirect } from "next/navigation";
import {
  getSettlementCycleReport,
  listSettlementCyclesForFilter,
  settlementCycleForEligibleDate,
} from "@kisan4u/orders";
import {
  Card,
  EmptyState,
  PageContainer,
  PageHeader,
  formatCurrency,
} from "@kisan4u/ui";
import { requireSettlementsView } from "@/lib/settlements-guard";
import { CycleFilter } from "./cycle-filter";
import { CycleSellersTable } from "./cycle-sellers-table";

export const dynamic = "force-dynamic";

/**
 * Admin settlement cycles — one slim row per seller for a chosen 9th/19th/
 * 29th payout batch: seller, amount due, Kisan4U's commission, the cycle,
 * status, and the two actions (mark paid / download Excel). Clicking a row
 * opens that seller's full settlement breakdown for this cycle only.
 */
export default async function AdminSettlementCyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  await requireSettlementsView();
  const { cycle: cycleKey } = await searchParams;

  const cycles = await listSettlementCyclesForFilter();
  const currentKey = settlementCycleForEligibleDate(new Date()).key;

  if (!cycleKey) {
    const fallback = cycles.find((c) => c.key === currentKey)?.key ?? cycles[0]?.key ?? currentKey;
    redirect(`/admin/settlements?cycle=${fallback}`);
  }

  const report = await getSettlementCycleReport(cycleKey);

  const filterOptions = cycles.map((c) => ({
    value: c.key,
    label: `${c.payoutLabel}${c.key === currentKey ? " (accruing now)" : ""} · ${c.windowLabel}${
      c.itemCount ? ` · ${c.itemCount} item${c.itemCount === 1 ? "" : "s"}` : ""
    }`,
  }));
  if (report && !filterOptions.some((o) => o.value === report.cycle.key)) {
    filterOptions.unshift({
      value: report.cycle.key,
      label: `${report.cycle.payoutLabel} · ${report.cycle.windowLabel}`,
    });
  }

  return (
    <PageContainer maxWidth="1300px" className="py-10">
      <PageHeader
        title="Settlement cycles"
        description="Seller payouts run on the 9th, 19th and 29th. An order joins a cycle 48 hours after delivery, once its return window closes. Pick a payout date, then click a seller to see the full breakdown for that cycle."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <CycleFilter options={filterOptions} value={report?.cycle.key ?? cycleKey} />
        {report && (
          <span className="text-sm text-gray-500">
            Window {report.cycle.windowLabel} → paid {report.cycle.payoutLabel}
          </span>
        )}
      </div>

      {!report ? (
        <EmptyState
          icon="🗓️"
          title="Unknown settlement cycle"
          description="That payout date doesn't correspond to a real 9th/19th/29th cycle."
        />
      ) : report.sellers.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Nothing in this cycle yet"
          description={`No settlements have become eligible for the ${report.cycle.payoutLabel} payout. Orders show up here 48 hours after they're delivered.`}
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Tile label="Sellers" value={String(report.totals.sellerCount)} />
            <Tile label="Kisan4U commission" value={formatCurrency(report.totals.commission)} />
            <Tile label="Total due to sellers" value={formatCurrency(report.totals.netPayable)} strong />
          </div>

          <CycleSellersTable
            payoutKey={report.cycle.key}
            payoutLabel={report.cycle.payoutLabel}
            windowLabel={report.cycle.windowLabel}
            payoutReached={Date.now() >= report.cycle.payoutDate.getTime()}
            sellers={report.sellers}
          />

          <p className="mt-4 text-xs text-gray-500">
            &ldquo;Mark paid&rdquo; is enabled once every non-reversed item for that seller in this
            cycle is <strong>eligible</strong> (its 48-hour hold has passed). It sets those rows to
            SETTLED — record the bank transfer outside the system as today.
          </p>
        </>
      )}
    </PageContainer>
  );
}

function Tile({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div
        className={`mt-1 ${strong ? "text-lg font-extrabold text-ink" : "text-base font-bold text-ink"}`}
      >
        {value}
      </div>
    </Card>
  );
}
