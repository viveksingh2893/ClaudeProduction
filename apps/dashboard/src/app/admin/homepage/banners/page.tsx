import { listPromotionalAssets } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { BannersManager } from "./banners-manager";

export default async function AdminHomepageBannersPage() {
  await requireSession(["ADMIN"]);
  const assets = await listPromotionalAssets();

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Hero, coupon & join banners"
        description="Manages PromotionalAsset rows for the hero carousel, coupon strip, and Become a Dealer / Become a Seller join banners."
      />
      <BannersManager assets={assets} />
    </PageContainer>
  );
}
