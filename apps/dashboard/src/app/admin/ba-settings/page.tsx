import { prisma } from "@kisan4u/db";
import { getBaSettings, listBaRateConfigs, isBaProgramEnabled } from "@kisan4u/orders";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { BaSettingsClient } from "./settings-client";

export default async function AdminBaSettingsPage() {
  await requireSession(["ADMIN"]);
  const [settings, rateConfigs, enabled, sellers] = await Promise.all([
    getBaSettings(),
    listBaRateConfigs(),
    isBaProgramEnabled(),
    prisma.sellerProfile.findMany({ select: { id: true, shopName: true }, orderBy: { shopName: "asc" } }),
  ]);

  return (
    <PageContainer className="py-8">
      <PageHeader
        title="Business Associate settings"
        description="Flat amounts, per-seller commission rates, and the program on/off switch."
      />
      <BaSettingsClient
        enabled={enabled}
        settings={settings}
        rateConfigs={rateConfigs.map((c) => ({
          id: c.id,
          label: c.label,
          sellerId: c.sellerId,
          sellerName: c.seller?.shopName ?? null,
          customerType: c.customerType,
          commissionPercent: Number(c.commissionPercent),
          isActive: c.isActive,
        }))}
        sellers={sellers.map((s) => ({ id: s.id, name: s.shopName }))}
      />
    </PageContainer>
  );
}
