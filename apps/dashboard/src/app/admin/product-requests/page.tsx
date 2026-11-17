import type { SellerProductRequestStatus } from "@kisan4u/db";
import { getAllProductRequestsForAdmin } from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";
import { ProductRequestsTable } from "./product-requests-table";

const STATUS_VALUES: SellerProductRequestStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "VIEWED",
  "RESPONDED",
  "CLOSED",
  "CANCELLED",
];

/** Admin can see every dealer↔seller request and is the only one who can move PENDING → APPROVED/REJECTED (see [id]/page.tsx). */
export default async function AdminProductRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const status = STATUS_VALUES.includes(sp.status as SellerProductRequestStatus)
    ? (sp.status as SellerProductRequestStatus)
    : undefined;

  const [{ rows: requests, total }, states] = await Promise.all([
    getAllProductRequestsForAdmin({
      q: sp.q,
      status,
      stateId: sp.state || undefined,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    prisma.indianState.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader
        title="Product requests"
        description="Dealer enquiries about products unavailable in their state. Review and approve to forward a sanitized summary to the seller, or reject with a reason."
      />
      <ProductRequestsTable
        requests={requests.map((r) => ({
          ...r,
          product: { ...r.product, primaryImageUrl: resolveStorefrontAssetUrl(r.product.primaryImageUrl) ?? "" },
        }))}
        states={states}
        total={total}
        page={page}
        pageSize={pageSize}
      />
    </PageContainer>
  );
}
