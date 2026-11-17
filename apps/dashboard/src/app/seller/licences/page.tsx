import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import {
  getSellerCurrentLicenceSubmissions,
  getTaxonomyPathLabelsForSubmissions,
} from "@kisan4u/catalog";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { SellerLicencesTable, type SellerLicenceRow } from "./licences-table";

function geoLabel(
  row: Awaited<ReturnType<typeof getSellerCurrentLicenceSubmissions>>[number],
): string {
  const parts: string[] = [];
  if (row.audience === "CUSTOMER" || row.audience === "BOTH") {
    parts.push(
      row.requirement.customerGeoType === "PAN_INDIA"
        ? "Customer: Pan India"
        : `Customer: ${row.customerStates.map((s) => s.name).join(", ") || "—"}`,
    );
  }
  if (row.audience === "DEALER" || row.audience === "BOTH") {
    parts.push(
      row.requirement.dealerGeoType === "PAN_INDIA"
        ? "Dealer: Pan India"
        : `Dealer: ${row.dealerStates.map((s) => s.name).join(", ") || "—"}`,
    );
  }
  return parts.join(" · ");
}

export default async function SellerLicencesPage() {
  const { sellerProfileId } = await requireApprovedSeller();

  const [rows, categories, subcategories, subSubCategories, states] = await Promise.all([
    getSellerCurrentLicenceSubmissions(sellerProfileId),
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
  ]);

  const pathLabels = await getTaxonomyPathLabelsForSubmissions(rows);

  const tableRows: SellerLicenceRow[] = rows.map((r) => ({
    id: r.id,
    requirementName: r.requirement.name,
    taxonomyPathLabel:
      pathLabels.get(`${r.requirement.taxonomyNodeType}:${r.requirement.taxonomyNodeId}`) ?? "—",
    source: r.requirement.taxonomyNodeType,
    audience: r.audience,
    geoLabel: geoLabel(r),
    licenceNumber: r.licenceNumber,
    expiryDate: r.expiryDate.toISOString(),
    submittedAt: r.submittedAt.toISOString(),
    status: r.status,
    rejectionReason: r.rejectionReason,
    revocationReason: r.revocationReason,
    requirementId: r.requirement.id,
    taxonomyNodeType: r.requirement.taxonomyNodeType,
    taxonomyNodeId: r.requirement.taxonomyNodeId,
  }));

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <PageHeader
        title="Selling Licences"
        description="Category-based selling licences required to list and sell regulated products — separate from your onboarding/GST/registration documents."
      />
      <SellerLicencesTable
        rows={tableRows}
        categories={categories}
        subcategories={subcategories}
        subSubCategories={subSubCategories}
        states={states}
      />
    </PageContainer>
  );
}
