import { listCategoryHomepageAssets } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { TopCategoriesManager } from "./top-categories-manager";

export default async function AdminTopCategoriesPage() {
  await requireSession(["ADMIN"]);
  const [assets, categories] = await Promise.all([
    listCategoryHomepageAssets(),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <PageContainer maxWidth="900px" className="py-8">
      <PageHeader
        title="Top Categories"
        description="A distinct square homepage image per category — never reuses the category's normal catalogue image."
      />
      <TopCategoriesManager
        assets={assets}
        categories={categories}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
