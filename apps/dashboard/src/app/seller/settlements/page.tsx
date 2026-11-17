import { getSettlementSummary, listCommissionTableRows } from "@kisan4u/orders";
import { AnchorButton, PageContainer, PageHeader } from "@kisan4u/ui";
import { Download } from "lucide-react";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { parseSettlementFilters, parseCommissionFilters } from "@/lib/settlement-filters";
import { serializeCommissionRow, serializeSettlementSummary } from "@/lib/settlement-view";
import { SettlementsTable } from "@/components/settlements-table";
import { SettlementSummaryTiles } from "@/components/settlement-summary-tiles";

export default async function SellerSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const sp = await searchParams;

  const [{ rows, total, page, pageSize }, summary] = await Promise.all([
    listCommissionTableRows(sellerProfileId, parseCommissionFilters(sp)),
    getSettlementSummary(sellerProfileId, parseSettlementFilters(sp)),
  ]);

  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) if (value) exportParams.set(key, value);

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <PageHeader
        title="Settlements"
        description="Every order item you own — pending, delivered, or otherwise — with the full commission, tax, and charge breakdown once it's delivered. The Excel download includes delivered orders only."
        actions={
          <AnchorButton href={`/api/seller/settlements/export?${exportParams.toString()}`} variant="outline" size="sm">
            <Download className="h-4 w-4" aria-hidden="true" />
            Download Excel
          </AnchorButton>
        }
      />
      <SettlementSummaryTiles summary={serializeSettlementSummary(summary)} />
      <SettlementsTable rows={rows.map(serializeCommissionRow)} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
