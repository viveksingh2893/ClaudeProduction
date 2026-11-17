import { getPosPricingConfig } from "@kisan4u/orders";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { PosPricingManager } from "./pos-pricing-manager";

export default async function PosPricingPage() {
  await requireSession(["ADMIN"]);
  const config = await getPosPricingConfig();

  return (
    <PageContainer maxWidth="640px" className="py-8">
      <PageHeader
        title="POS pricing"
        description="Discount rate per payment mode — applies to customer orders placed through POS only."
      />
      <PosPricingManager config={config} />
    </PageContainer>
  );
}
