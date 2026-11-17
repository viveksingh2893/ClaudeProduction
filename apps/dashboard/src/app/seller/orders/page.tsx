import type { OrderStatus } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { listSellerOrdersForSellerPaginated, resolveOrderItemImageUrls } from "@kisan4u/orders";
import { requireApprovedSeller } from "@/lib/require-approved-seller";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";
import { buildSellerOrderRow } from "@/lib/seller-order-row";
import { SellerOrdersTable } from "./seller-orders-table";

const STATUS_VALUES = Object.keys(ORDER_STATUS_LABEL);

export default async function SellerOrdersPage({
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
    search: sp.q,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    sortKey: sp.sort,
    sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
    page,
    pageSize,
  });

  // Only the first item per order needs a resolved image for this list's
  // compact "Item" column (the detail page shows every item) — keeps the
  // resolver's live-fallback lookups bounded to at most one per row.
  const firstItems = orders
    .map((o) => o.items[0])
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item) => ({ ...item, key: item.id }));
  const imageByItemId = await resolveOrderItemImageUrls(firstItems);

  // SellerOrder carries a Decimal (totalAmount) that isn't
  // plain-serializable across the Server -> Client boundary — see the same
  // fix in admin/orders/page.tsx. buildSellerOrderRow trims each order to
  // exactly what SellerOrdersTable renders, shared with the Returns tab.
  const rows = orders.map((o) => buildSellerOrderRow(o, imageByItemId));

  return (
    <PageContainer maxWidth="1200px" className="py-8">
      <PageHeader title="Orders" />
      <SellerOrdersTable
        orders={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        showInlineStatus
      />
    </PageContainer>
  );
}
