import { listSellerOrdersForAdmin, resolveOrderItemImageUrls } from "@kisan4u/orders";
import type {
  OrderStatus,
  UserRole,
  DeliveryMethod,
  PaymentStatus,
  PaymentMethod,
} from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { buildAdminOrderRow } from "@/lib/admin-order-row";
import { OrdersTable } from "../orders/orders-table";

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAYMENT_PARTIALLY_RECEIVED",
  "CONFIRMED",
  "SELLER_ACCEPTED",
  "PACKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "DELIVERY_FAILED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
];
const CUSTOMER_TYPES: UserRole[] = ["CUSTOMER", "DEALER"];
const DELIVERY_METHODS: DeliveryMethod[] = ["KISAN4U_COURIER", "TRANSPORT"];
const PAYMENT_STATUSES: PaymentStatus[] = [
  "PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
];
const PAYMENT_METHODS: PaymentMethod[] = [
  "COD",
  "ONLINE_FULL",
  "ONLINE_PARTIAL",
  "WALLET",
  "TRANSPORT_FULL_ONLINE",
];

/**
 * Same table, same columns, same data as /admin/orders (see
 * buildAdminOrderRow) — the ONLY difference is the query is scoped to
 * orders with a return request (a RefundRequest) OR a cancellation
 * request (ever reached CANCELLATION_REQUESTED — see
 * hasReturnOrCancellationRequest's own doc comment), and "View" links
 * into the exact same /admin/orders/[id] detail page (viewBasePath
 * defaults there), not a separate return-specific page. Same reuse
 * pattern /admin/payment-verification already established for a
 * differently-scoped, differently-linked copy of this same table.
 */
export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const status = ORDER_STATUSES.includes(sp.status as OrderStatus)
    ? (sp.status as OrderStatus)
    : undefined;
  const customerType = CUSTOMER_TYPES.includes(sp.customerType as UserRole)
    ? (sp.customerType as UserRole)
    : undefined;
  const deliveryMethod = DELIVERY_METHODS.includes(sp.deliveryMethod as DeliveryMethod)
    ? (sp.deliveryMethod as DeliveryMethod)
    : undefined;
  const paymentStatus = PAYMENT_STATUSES.includes(sp.paymentStatus as PaymentStatus)
    ? (sp.paymentStatus as PaymentStatus)
    : undefined;
  const paymentMethod = PAYMENT_METHODS.includes(sp.paymentMethod as PaymentMethod)
    ? (sp.paymentMethod as PaymentMethod)
    : undefined;

  const { rows: orders, total } = await listSellerOrdersForAdmin({
    status,
    customerType,
    deliveryMethod,
    paymentStatus,
    paymentMethod,
    hasReturnOrCancellationRequest: true,
    search: sp.q || undefined,
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

  const rows = orders.map((order) => buildAdminOrderRow(order, imageByItemId));

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <PageHeader
        title="Return and Cancel"
        description="Orders with a return or cancellation request. Open an order to review, approve/reject, and complete its refund."
      />
      <OrdersTable rows={rows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
