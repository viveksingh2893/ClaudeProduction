import type { LicenceStatus, SellerLicenceAudience } from "@kisan4u/db";
import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { getAdminLicenceKpis, getAdminLicenceSellerSummaries } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";
import { SellerLicencesAdminTable } from "./seller-licences-table";

const STATUS_VALUES: LicenceStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
];
const AUDIENCE_VALUES: SellerLicenceAudience[] = ["CUSTOMER", "DEALER", "BOTH"];
const COVERAGE_VALUES = ["PAN_INDIA", "STATE_WISE"] as const;

export default async function AdminSellerLicencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [10, 20, 50].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 10;
  const status = STATUS_VALUES.includes(sp.status as LicenceStatus)
    ? (sp.status as LicenceStatus)
    : undefined;
  const audience = AUDIENCE_VALUES.includes(sp.audience as SellerLicenceAudience)
    ? (sp.audience as SellerLicenceAudience)
    : undefined;
  const coverage = COVERAGE_VALUES.includes(sp.coverage as (typeof COVERAGE_VALUES)[number])
    ? (sp.coverage as (typeof COVERAGE_VALUES)[number])
    : undefined;
  const requirementId = sp.requirementId || undefined;

  const [kpis, { sellers, total }, categories, subcategories, subSubCategories, states, allSellers, requirements] =
    await Promise.all([
      getAdminLicenceKpis(),
      getAdminLicenceSellerSummaries({
        search: sp.q,
        status,
        audience,
        coverage,
        requirementId,
        page,
        pageSize,
      }),
      prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.subcategory.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, categoryId: true },
      }),
      prisma.subSubCategory.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, subCategoryId: true },
      }),
      prisma.indianState.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.sellerProfile.findMany({
        where: { status: "APPROVED" },
        orderBy: { shopName: "asc" },
        select: { id: true, shopName: true },
      }),
      // Populates the "Any licence type" filter — every requirement any
      // seller could plausibly have a submission against, not just
      // currently-active ones, so a filter someone picks against an old
      // submission never silently vanishes from the dropdown.
      prisma.licenceRequirement.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        distinct: ["name"],
      }),
    ]);

  return (
    <PageContainer className="py-8" maxWidth="1500px">
      <PageHeader
        title="Seller Licences"
        description="Manage and review all selling-licence submissions from sellers across categories."
      />
      <SellerLicencesAdminTable
        kpis={kpis}
        sellers={sellers}
        total={total}
        page={page}
        pageSize={pageSize}
        categories={categories}
        subcategories={subcategories}
        subSubCategories={subSubCategories}
        states={states}
        allSellers={allSellers}
        requirements={requirements}
      />
    </PageContainer>
  );
}
