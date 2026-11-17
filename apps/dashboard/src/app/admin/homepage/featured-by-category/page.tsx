import { listFeaturedByCategoryCollections } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { FeaturedByCategoryManager } from "./featured-manager";

export default async function AdminFeaturedByCategoryPage() {
  await requireSession(["ADMIN"]);
  const [collections, categories] = await Promise.all([
    listFeaturedByCategoryCollections(),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Featured Products by Category"
        description="Up to 5 categories, each with up to 10 featured products."
      />
      <FeaturedByCategoryManager collections={collections} categories={categories} />
    </PageContainer>
  );
}
