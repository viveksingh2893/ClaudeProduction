import type { SellerProductRequestStatus } from "@kisan4u/db";
import { getSellerRequestsPaginated } from "@kisan4u/catalog";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { SellerRequestsTable } from "./seller-requests-table";

// A seller may only ever be shown admin-approved (or later) requests —
// never PENDING (still under admin review) or REJECTED (admin declined).
// Must mirror SELLER_VISIBLE_STATUSES in packages/catalog/src/product-requests.ts.
const STATUS_VALUES: SellerProductRequestStatus[] = [
  "APPROVED",
  "VIEWED",
  "RESPONDED",
  "CLOSED",
  "CANCELLED",
];

export default async function SellerRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const status = STATUS_VALUES.includes(sp.status as SellerProductRequestStatus)
    ? (sp.status as SellerProductRequestStatus)
    : undefined;

  const { rows: requests, total } = await getSellerRequestsPaginated(sellerProfileId, {
    status,
    q: sp.q,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    sortKey: sp.sort,
    sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
    page,
    pageSize,
  });

  const rows = requests.map((r) => ({
    id: r.id,
    publicRequestNumber: r.publicRequestNumber,
    createdAt: r.createdAt,
    product: {
      name: r.product.name,
      primaryImageUrl: resolveStorefrontAssetUrl(r.product.primaryImageUrl) ?? "",
    },
    quantity: r.quantity,
    status: r.status,
  }));

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <PageHeader
        title="Dealer requests"
        description="Enquiries from dealers about your products — not orders. No stock is reserved and no price is calculated."
      />
      <SellerRequestsTable requests={rows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
