import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { SubSubCategoriesManager } from "./sub-subcategories-manager";

export default async function AdminSubSubCategoriesPage() {
  await requireSession(["ADMIN"]);
  const [categories, subcategories, subSubCategoriesRaw, licenceCounts] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.subcategory.findMany({ orderBy: { name: "asc" } }),
    prisma.subSubCategory.findMany({
      orderBy: { name: "asc" },
      include: { translations: { select: { language: true, name: true } } },
    }),
    prisma.licenceRequirement.groupBy({
      by: ["taxonomyNodeId"],
      where: { taxonomyNodeType: "SUBSUBCATEGORY", isActive: true, nextVersion: { is: null } },
      _count: { _all: true },
    }),
  ]);
  const licenceCountById = new Map(licenceCounts.map((c) => [c.taxonomyNodeId, c._count._all]));
  const subSubCategories = subSubCategoriesRaw.map((x) => ({
    ...x,
    activeLicenceRequirementCount: licenceCountById.get(x.id) ?? 0,
  }));

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Sub-subcategories"
        description="The deepest level of the fixed 3-level hierarchy. Pick a category to filter the subcategory options, then select the subcategory this belongs to."
      />
      <SubSubCategoriesManager
        categories={categories}
        subcategories={subcategories}
        subSubCategories={subSubCategories}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
