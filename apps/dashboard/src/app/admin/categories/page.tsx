import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  createCategoryAction,
  updateCategoryAction,
  toggleCategoryActiveAction,
  setCategoryHomepagePositionAction,
  uploadCategoryImageAction,
} from "./actions";

export default async function AdminCategoriesPage() {
  await requireSession(["ADMIN"]);
  const categories = await prisma.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { translations: { select: { language: true, name: true } } },
  });

  // Displayed rank is computed live (1..N over the active set, in current
  // position/name order) rather than trusting the raw stored `position`
  // integer to already be a clean 1..N sequence — setCategoryHomepagePositionAction
  // re-ranks the whole active set on every write, but a category created
  // before this feature existed may still hold a stale/duplicate raw value
  // until it's next touched.
  const licenceCounts = await prisma.licenceRequirement.groupBy({
    by: ["taxonomyNodeId"],
    where: { taxonomyNodeType: "CATEGORY", isActive: true, nextVersion: { is: null } },
    _count: { _all: true },
  });
  const licenceCountByCategoryId = new Map(
    licenceCounts.map((c) => [c.taxonomyNodeId, c._count._all]),
  );

  let rank = 0;
  const items = categories.map((c) => ({
    ...c,
    homepagePosition: c.isActive ? ++rank : undefined,
    activeLicenceRequirementCount: licenceCountByCategoryId.get(c.id) ?? 0,
  }));

  return (
    <PageContainer className="py-8" maxWidth="1100px">
      <PageHeader
        title="Categories"
        description={
          <>
            Top-level categories. Subcategories belong to exactly one of these — see{" "}
            <code>/admin/subcategories</code>. The &ldquo;Shop by Category&rdquo; position controls
            homepage card order — every active category appears there automatically; this only
            reorders them.
          </>
        }
      />
      <MasterDataManager
        label="Category"
        items={items}
        hasImage
        hasEmoji
        hasNameTranslations
        hasHomepagePosition
        showLicenceConfig
        onCreate={createCategoryAction}
        onUpdate={updateCategoryAction}
        onToggleActive={toggleCategoryActiveAction}
        onSetHomepagePosition={setCategoryHomepagePositionAction}
        onUploadImage={uploadCategoryImageAction}
        storefrontBaseUrl={process.env.STOREFRONT_PUBLIC_URL ?? null}
      />
    </PageContainer>
  );
}
