import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@kisan4u/db";
import {
  getSettlementCycleReport,
  getSettlementSummary,
  listCommissionTableRows,
  settlementCycleFromKey,
} from "@kisan4u/orders";
import { AnchorButton, PageContainer, PageHeader } from "@kisan4u/ui";
import { ArrowLeft, Download } from "lucide-react";
import { requireSettlementsView } from "@/lib/settlements-guard";
import { parseCommissionFilters, parseSettlementFilters } from "@/lib/settlement-filters";
import { serializeCommissionRow, serializeSettlementSummary } from "@/lib/settlement-view";
import { SettlementSummaryTiles } from "@/components/settlement-summary-tiles";
import { AdminSettlementsSection } from "@/app/admin/sellers/[id]/admin-settlements-section";
import { MarkCycleSettledButton } from "../../mark-settled-button";

export const dynamic = "force-dynamic";

/**
 * One seller's full settlement breakdown, scoped to a single payout cycle
 * — the same line-item table shown at the bottom of /admin/sellers/[id],
 * but filtered to the settlements whose frozen cyclePayoutDate matches the
 * chosen 9th/19th/29th batch. Reached by clicking a row on
 * /admin/settlements.
 */
export default async function CycleSellerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycle: string; sellerId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSettlementsView();
  const { cycle: cycleKey, sellerId } = await params;
  const sp = await searchParams;

  const cycle = settlementCycleFromKey(cycleKey);
  if (!cycle) notFound();

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true, shopName: true },
  });
  if (!seller) notFound();

  // Force the cycle scope regardless of anything in the URL.
  const commissionFilters = { ...parseCommissionFilters(sp), cyclePayoutKey: cycleKey };
  const settlementFilters = { ...parseSettlementFilters(sp), cyclePayoutKey: cycleKey };

  const [commissionResult, summary, cycleReport] = await Promise.all([
    listCommissionTableRows(seller.id, commissionFilters),
    getSettlementSummary(seller.id, settlementFilters),
    getSettlementCycleReport(cycleKey),
  ]);
  const sellerRow = cycleReport?.sellers.find((s) => s.sellerId === seller.id);

  // Everything except pagination flows through to the Excel export so it
  // matches whatever the admin is looking at.
  const exportParams = new URLSearchParams({ cycle: cycleKey });
  for (const [k, v] of Object.entries(sp)) {
    if (v && k !== "page" && k !== "pageSize") exportParams.set(k, v);
  }

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <Link
        href={`/admin/settlements?cycle=${cycleKey}`}
        className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All sellers in this cycle
      </Link>

      <PageHeader
        title={seller.shopName}
        description={`Settlement for the ${cycle.payoutLabel} payout · window ${cycle.windowLabel}. Delivered order items whose 48-hour hold landed in this cycle.`}
        actions={
          <div className="flex items-center gap-2">
            <AnchorButton
              href={`/api/admin/sellers/${seller.id}/settlements/export?${exportParams.toString()}`}
              variant="outline"
              size="sm"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download Excel
            </AnchorButton>
            <MarkCycleSettledButton
              payoutKey={cycleKey}
              sellerId={seller.id}
              disabled={!sellerRow?.readyToSettle}
              notYetPayableLabel={
                Date.now() >= cycle.payoutDate.getTime() ? undefined : cycle.payoutLabel
              }
            />
          </div>
        }
      />

      <SettlementSummaryTiles summary={serializeSettlementSummary(summary)} />
      <AdminSettlementsSection
        rows={commissionResult.rows.map(serializeCommissionRow)}
        total={commissionResult.total}
        page={commissionResult.page}
        pageSize={commissionResult.pageSize}
      />
    </PageContainer>
  );
}
