import { listFeaturedBySubcategoryCollections } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { FeaturedBySubcategoryManager } from "./featured-manager";

export default async function AdminFeaturedBySubcategoryPage() {
  await requireSession(["ADMIN"]);
  const [collections, subcategories] = await Promise.all([
    listFeaturedBySubcategoryCollections(),
    prisma.subcategory.findMany({
      where: { isActive: true, category: { isActive: true } },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, category: { select: { name: true } } },
    }),
  ]);

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Featured Products by Sub-category"
        description="Every active sub-category appears on the homepage automatically (12 products each — ranked here, or random when unranked). Rank as many sub-categories as you like."
      />
      <FeaturedBySubcategoryManager collections={collections} subcategories={subcategories} />
    </PageContainer>
  );
}
