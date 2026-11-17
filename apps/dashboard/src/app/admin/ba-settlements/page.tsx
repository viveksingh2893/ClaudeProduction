import { getBaSettlementOverview } from "@kisan4u/orders";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { BaSettlementsClient } from "./settlements-client";

export default async function AdminBaSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;
  const overview = await getBaSettlementOverview(sp.month);

  return (
    <PageContainer className="py-8">
      <PageHeader
        title="Business Associate settlements"
        description={`Payout cycle: ${overview.monthLabel} (runs at month end). Transfer funds manually, then mark paid.`}
      />
      <BaSettlementsClient overview={overview} />
    </PageContainer>
  );
}
