import {
  listPartialPaymentConfigs,
  listCollectionChargeConfigs,
  listSettlementRateConfigs,
} from "@kisan4u/orders";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { OrderSettingsManager } from "./order-settings-manager";

export default async function AdminOrderSettingsPage() {
  await requireSession(["ADMIN"]);
  const [partial, collection, settlementRates] = await Promise.all([
    listPartialPaymentConfigs(),
    listCollectionChargeConfigs(),
    listSettlementRateConfigs(),
  ]);

  // Prisma's Decimal `value` field isn't plain-serializable across the
  // Server -> Client Component boundary — trim to exactly what
  // OrderSettingsManager renders, as a plain string.
  const partialConfigs = partial.map((c) => ({
    id: c.id,
    label: c.label,
    appliesTo: c.appliesTo,
    ruleType: c.ruleType,
    value: c.value.toString(),
    isActive: c.isActive,
    isDemo: c.isDemo,
  }));
  const collectionConfigs = collection.map((c) => ({
    id: c.id,
    label: c.label,
    chargeType: c.chargeType,
    value: c.value.toString(),
    minCharge: c.minCharge != null ? c.minCharge.toString() : null,
    isActive: c.isActive,
  }));
  // Business Settings only ever edits the global row (sellerId and
  // customerType both null) in this first admin-UI pass.
  const settlementRateConfigs = settlementRates
    .filter((c) => c.sellerId === null && c.customerType === null)
    .map((c) => ({
      id: c.id,
      label: c.label,
      commissionGstPercent: c.commissionGstPercent.toString(),
      logisticsGstPercent: c.logisticsGstPercent.toString(),
      collectionChargeGstPercent: c.collectionChargeGstPercent.toString(),
      isActive: c.isActive,
    }));

  return (
    <PageContainer className="py-8" maxWidth="800px">
      <PageHeader title="Order settings" />
      <OrderSettingsManager
        partialConfigs={partialConfigs}
        collectionConfigs={collectionConfigs}
        settlementRateConfigs={settlementRateConfigs}
      />
    </PageContainer>
  );
}
