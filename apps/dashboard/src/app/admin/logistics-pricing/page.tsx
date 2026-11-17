import { getLogisticsConfig } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { LogisticsPricingManager } from "./logistics-pricing-manager";
import { saveLogisticsConfigAction } from "./actions";

export default async function AdminLogisticsPricingPage() {
  await requireSession(["ADMIN"]);
  const config = await getLogisticsConfig();

  return (
    <PageContainer className="py-8" maxWidth="800px">
      <PageHeader
        title="Logistics price logic"
        description="Master data only for now — shipment weight price slabs. Not yet connected to checkout, orders, settlements, or seller charges."
      />
      <LogisticsPricingManager
        initial={
          config
            ? {
                id: config.id,
                maxWeightGrams: config.maxWeightGrams,
                aboveMaxPrice: config.aboveMaxPrice.toString(),
                isActive: config.isActive,
                slabs: config.slabs.map((s) => ({
                  lowerWeightGrams: s.lowerWeightGrams,
                  upperWeightGrams: s.upperWeightGrams,
                  price: s.price.toString(),
                })),
              }
            : null
        }
        onSave={saveLogisticsConfigAction}
      />
    </PageContainer>
  );
}
