import type { OrderStatus } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { listSellerOrdersForSellerPaginated, resolveOrderItemImageUrls } from "@kisan4u/orders";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";
import { buildSellerOrderRow } from "@/lib/seller-order-row";
import { SellerOrdersTable } from "../orders/seller-orders-table";

const STATUS_VALUES = Object.keys(ORDER_STATUS_LABEL);

/**
 * Same table, same columns, same data as /seller/orders (see
 * buildSellerOrderRow) — the ONLY difference is the query is scoped to
 * orders with a return request (a RefundRequest) OR a cancellation
 * request (ever reached CANCELLATION_REQUESTED — see
 * hasReturnOrCancellationRequest's own doc comment), and "View" links
 * into the exact same /seller/orders/[id] detail page (viewBasePath
 * defaults there), not a separate return-specific page.
 */
export default async function SellerReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { sellerProfileId } = await requireApprovedSeller();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const status = STATUS_VALUES.includes(sp.status ?? "") ? (sp.status as OrderStatus) : undefined;

  const { rows: orders, total } = await listSellerOrdersForSellerPaginated(sellerProfileId, {
    status,
    hasReturnOrCancellationRequest: true,
    search: sp.q,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    sortKey: sp.sort,
    sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
    page,
    pageSize,
  });

  const firstItems = orders
    .map((o) => o.items[0])
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item) => ({ ...item, key: item.id }));
  const imageByItemId = await resolveOrderItemImageUrls(firstItems);

  const rows = orders.map((o) => buildSellerOrderRow(o, imageByItemId));

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <PageHeader
        title="Return and Cancel"
        description="Orders with a return or cancellation request against your products."
      />
      <SellerOrdersTable orders={rows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
