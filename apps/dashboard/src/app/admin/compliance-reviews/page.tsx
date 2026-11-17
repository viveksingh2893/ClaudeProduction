import { PageContainer, PageHeader } from "@kisan4u/ui";
import { getComplianceReviews } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";
import { ComplianceReviewsTable, type ComplianceReviewRow } from "./compliance-reviews-table";

export default async function AdminComplianceReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;
  const status = sp.status === "RESOLVED" ? "RESOLVED" : "OPEN";

  const { rows } = await getComplianceReviews({ status, pageSize: 100 });
  const tableRows: ComplianceReviewRow[] = rows.map((r) => ({
    id: r.id,
    productId: r.product.id,
    productName: r.product.name,
    sellerName: r.seller.shopName,
    requirementName: r.requirement?.name ?? null,
    reason: r.reason,
    affectedAudience: r.affectedAudience,
    detail: r.detail,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader
        title="Compliance Reviews"
        description="Products automatically restricted after a licence expired, was rejected/revoked, or a requirement changed. Resolve once you've confirmed the restriction is correct or the seller has fixed it."
      />
      <ComplianceReviewsTable rows={tableRows} />
    </PageContainer>
  );
}
