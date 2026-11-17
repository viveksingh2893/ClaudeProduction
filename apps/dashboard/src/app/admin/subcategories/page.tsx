import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { SubcategoriesManager } from "./subcategories-manager";

export default async function AdminSubcategoriesPage() {
  await requireSession(["ADMIN"]);
  const [categories, subcategoriesRaw, licenceCounts] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.subcategory.findMany({
      orderBy: { name: "asc" },
      include: { translations: { select: { language: true, name: true } } },
    }),
    prisma.licenceRequirement.groupBy({
      by: ["taxonomyNodeId"],
      where: { taxonomyNodeType: "SUBCATEGORY", isActive: true, nextVersion: { is: null } },
      _count: { _all: true },
    }),
  ]);
  const licenceCountById = new Map(licenceCounts.map((c) => [c.taxonomyNodeId, c._count._all]));
  const subcategories = subcategoriesRaw.map((s) => ({
    ...s,
    activeLicenceRequirementCount: licenceCountById.get(s.id) ?? 0,
  }));

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Subcategories"
        description={
          <>
            Each subcategory belongs to exactly one category. Sub-subcategories belong to exactly
            one of these — see <code>/admin/sub-subcategories</code>.
          </>
        }
      />
      <SubcategoriesManager
        categories={categories}
        subcategories={subcategories}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
