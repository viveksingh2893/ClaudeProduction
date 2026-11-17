import { listDealsOfTheDay } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { DealsManager } from "./deals-manager";

export default async function AdminDealOfTheDayPage() {
  await requireSession(["ADMIN"]);
  const rawDeals = await listDealsOfTheDay();
  // Prisma's Decimal is a class instance, not a plain object — Next.js
  // can't serialize it across the Server->Client Component boundary.
  // Rebuilt as an explicit plain object (not a spread of the Prisma row)
  // so no other non-plain field can slip through unnoticed.
  const deals = rawDeals.map((d) => ({
    id: d.id,
    productId: d.productId,
    variantId: d.variantId,
    dealPrice: Number(d.dealPrice),
    startAt: d.startAt,
    endAt: d.endAt,
    isActive: d.isActive,
    product: { id: d.product.id, name: d.product.name, slug: d.product.slug },
    variant: d.variant ? { id: d.variant.id, sku: d.variant.sku } : null,
  }));

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Deal of the Day"
        description="Deal price is enforced authoritatively at checkout (packages/orders/src/pricing-resolution.ts) — it always stops applying atomically once the schedule window ends, even on a stale browser tab. Customer-audience only, never dealer pricing."
      />
      <DealsManager deals={deals} />
    </PageContainer>
  );
}
