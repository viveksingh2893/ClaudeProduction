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
import { AlertTriangle, Clock3, FileCheck2, Truck } from "lucide-react";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";
import { buildAdminOrderRow } from "@/lib/admin-order-row";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { OrdersTable } from "./orders-table";

const TAB_VALUES = new Set([
  "all",
  "needsAttention",
  "new",
  "processing",
  "inTransit",
  "delivered",
  "cancelled",
]);
const TAB_LABEL = {
  needsAttention: "Needs action",
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

export default async function AdminOrdersPage({
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

  // Prisma's Decimal fields (and the rest of this query's deep relation
  // tree — charge, checkoutGroup, etc.) aren't plain serializable objects,
  // so they can't cross the Server -> Client Component boundary as-is.
  // buildAdminOrderRow trims each order to exactly what OrdersTable
  // renders, as plain strings/primitives — shared with the restricted
  // "Payment Verifier" order list so both show identical figures.
  const rows = orders.map((order) => buildAdminOrderRow(order, imageByItemId));

  function tabHref(tabKey: string) {
    const params = new URLSearchParams();
    if (tabKey !== "all") params.set("tab", tabKey);
    return params.toString() ? `/admin/orders?${params.toString()}` : "/admin/orders";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", count: summary.total, href: tabHref("all") },
    {
      key: "needsAttention",
      label: TAB_LABEL.needsAttention,
      count: summary.needsAttention,
      href: tabHref("needsAttention"),
    },
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
    // 1400px — enough for this table's extra columns (vs. the 1300px app
    // default) without forcing horizontal scroll on a generic 1440px-wide
    // desktop once the sidebar (250px) and page padding are subtracted; the
    // 1600px this used briefly needed a ~1920px-wide monitor to avoid it.
    <PageContainer maxWidth="1400px" className="py-10">
      <PageHeader title="Orders" description="Monitor seller orders, payments and fulfilment." />

      <StatCardsRow>
        <StatCard icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />} label="Total orders" value={summary.total} />
        <StatCard icon={<Clock3 className="h-5 w-5" aria-hidden="true" />} label="Orders today" value={summary.today} tone="blue" />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label="Awaiting confirmation"
          value={summary.awaitingConfirmation}
          hint="Admin action required"
          tone={summary.awaitingConfirmation > 0 ? "amber" : "neutral"}
        />
        <StatCard icon={<Truck className="h-5 w-5" aria-hidden="true" />} label="In progress" value={summary.inProgress} />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label="Needs attention"
          value={summary.needsAttention}
          hint={`${summary.paymentReviewCount} payment · ${summary.deliveryProblemCount} delivery`}
          tone={summary.needsAttention > 0 ? "red" : "neutral"}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.paymentReviewCount > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.paymentReviewCount} prepaid order${summary.paymentReviewCount === 1 ? "" : "s"} need payment-proof review`}
            href="/admin/payment-verification"
            linkLabel="Review payments"
          />
        )}
        {summary.deliveryProblemCount > 0 && (
          <AlertBanner
            tone="red"
            title={`${summary.deliveryProblemCount} order${summary.deliveryProblemCount === 1 ? " has a" : "s have"} delivery problem${summary.deliveryProblemCount === 1 ? "" : "s"}`}
            href={tabHref("needsAttention")}
            linkLabel="View"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />

      <OrdersTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        showInlineStatus
      />
    </PageContainer>
  );
}
