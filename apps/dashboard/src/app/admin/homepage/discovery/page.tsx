import { getDiscoveryCollection } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { DiscoveryManager } from "./discovery-manager";

export default async function AdminDiscoveryPage() {
  await requireSession(["ADMIN"]);
  const [trending, bestSellers, newArrivals] = await Promise.all([
    getDiscoveryCollection("TRENDING"),
    getDiscoveryCollection("BEST_SELLERS"),
    getDiscoveryCollection("NEW_ARRIVALS"),
  ]);

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Product Discovery"
        description="Trending, Best Sellers and New Arrivals share one storefront component (tabs). MANUAL uses your ordered picks below; AUTOMATIC falls back to featured position / recency."
      />
      <DiscoveryManager trending={trending} bestSellers={bestSellers} newArrivals={newArrivals} />
    </PageContainer>
  );
}
