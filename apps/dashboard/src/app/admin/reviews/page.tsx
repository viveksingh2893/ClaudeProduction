import { listReviewsForAdmin } from "@kisan4u/catalog";
import type { ReviewModerationStatus, ReviewSource } from "@kisan4u/db";
import { getFullName } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { ReviewsTable } from "./reviews-table";
import { ManualReviewButton } from "./manual-review-form";

const MODERATION_STATUSES: ReviewModerationStatus[] = ["PENDING", "APPROVED", "REJECTED", "HIDDEN"];
const SOURCES: ReviewSource[] = ["WEBSITE", "MANUAL_OFFLINE"];

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const moderationStatus = MODERATION_STATUSES.includes(sp.status as ReviewModerationStatus) ? (sp.status as ReviewModerationStatus) : undefined;
  const source = SOURCES.includes(sp.source as ReviewSource) ? (sp.source as ReviewSource) : undefined;
  const rating = sp.rating && /^[1-5]$/.test(sp.rating) ? Number(sp.rating) : undefined;
  const verifiedPurchase = sp.verified === "yes" ? true : sp.verified === "no" ? false : undefined;

  const { rows, total } = await listReviewsForAdmin({
    q: sp.q,
    moderationStatus,
    source,
    rating,
    verifiedPurchase,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    sortKey: sp.sort,
    sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
    page,
    pageSize,
  });

  // ProductReview carries no Decimal fields itself, but keep the same
  // "trim to a plain shape before crossing into a Client Component"
  // discipline this codebase uses everywhere else — `createdAt` is a
  // Date, which IS serializable, but explicit mapping keeps this page
  // resilient if the query's select ever grows a Decimal/relation field.
  const reviewRows = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    moderationStatus: r.moderationStatus,
    source: r.source,
    verifiedPurchase: r.verifiedPurchase,
    manualCustomerName: r.manualCustomerName,
    moderationNote: r.moderationNote,
    sourceReference: r.sourceReference,
    createdAt: r.createdAt,
    product: {
      id: r.product.id,
      name: r.product.name,
      primaryImageUrl: resolveStorefrontAssetUrl(r.product.primaryImageUrl) ?? "",
    },
    customer: r.customer ? { id: r.customer.id, name: getFullName(r.customer) ?? "—" } : null,
    orderNumber: r.orderItem?.sellerOrder.orderNumber ?? null,
  }));

  return (
    <PageContainer maxWidth="1300px" className="py-8">
      <PageHeader
        title="Review moderation"
        description="Product Card Design Spec: rating only shows on the storefront once a product has enough approved reviews (see Site Settings' rating threshold)."
        actions={<ManualReviewButton />}
      />
      <ReviewsTable rows={reviewRows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
