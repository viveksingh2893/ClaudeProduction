import {
  getAdminOrdersOperationalSummary,
  listSellerOrdersForAdmin,
  resolveOrderItemImageUrls,
  type AdminOrderStatusGroup,
} from "@kisan4u/orders";
import type {
  OrderStatus,
  UserRole,
  DeliveryMethod,
  PaymentStatus,
  PaymentMethod,
} from "@kisan4u/db";
import { FileCheck2 } from "lucide-react";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";
import { buildAdminOrderRow } from "@/lib/admin-order-row";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { OrdersTable } from "../../orders/orders-table";

const TAB_VALUES = new Set([
  "all",
  "new",
  "processing",
  "inTransit",
  "delivered",
  "cancelled",
]);
const TAB_LABEL = {
  new: "New",
  processing: "Processing",
  inTransit: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
} as const;

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
 * Order History — the Scheduling Team's read-only, browsable record of
 * every order (any status, searchable/filterable), a calmer sibling of
 * their own active work queue at /admin/order-scheduling (which shows
 * only in-progress/actionable orders with inline Confirm/status
 * controls). Same guard, same underlying query and row shape as
 * /admin/orders — see that page's identical structure — just with
 * `showInlineStatus` left at its default `false`, so the list itself has
 * no quick-action controls; opening a row still reaches the full detail
 * page where the Scheduling Team's own edit permissions still apply.
 */
export default async function OrderHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireOrdersSectionView();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const tab = TAB_VALUES.has(sp.tab ?? "") ? (sp.tab ?? "all") : "all";
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

  const [{ rows: orders, total }, summary] = await Promise.all([
    listSellerOrdersForAdmin({
      status,
      statusGroup: tab === "all" ? undefined : (tab as AdminOrderStatusGroup),
      customerType,
      deliveryMethod,
      paymentStatus,
      paymentMethod,
      search: sp.q || undefined,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    getAdminOrdersOperationalSummary(),
  ]);

  const firstItems = orders
    .map((o) => o.items[0])
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item) => ({ ...item, key: item.id }));
  const imageByItemId = await resolveOrderItemImageUrls(firstItems);
  const rows = orders.map((order) => buildAdminOrderRow(order, imageByItemId));

  function tabHref(tabKey: string) {
    const params = new URLSearchParams();
    if (tabKey !== "all") params.set("tab", tabKey);
    return params.toString()
      ? `/admin/order-scheduling/history?${params.toString()}`
      : "/admin/order-scheduling/history";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", count: summary.total, href: tabHref("all") },
    { key: "new", label: TAB_LABEL.new, count: summary.groupCounts.new, href: tabHref("new") },
    {
      key: "processing",
      label: TAB_LABEL.processing,
      count: summary.groupCounts.processing,
      href: tabHref("processing"),
    },
    {
      key: "inTransit",
      label: TAB_LABEL.inTransit,
      count: summary.groupCounts.inTransit,
      href: tabHref("inTransit"),
    },
    {
      key: "delivered",
      label: TAB_LABEL.delivered,
      count: summary.groupCounts.delivered,
      href: tabHref("delivered"),
    },
    {
      key: "cancelled",
      label: TAB_LABEL.cancelled,
      count: summary.groupCounts.cancelled,
      href: tabHref("cancelled"),
    },
  ];

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <PageHeader title="Order History" description="Browse every order — any status, searchable and filterable." />

      <StatCardsRow>
        <StatCard icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />} label="Total orders" value={summary.total} />
      </StatCardsRow>

      <StatusTabs items={tabs} activeKey={tab} />

      <OrdersTable rows={rows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
