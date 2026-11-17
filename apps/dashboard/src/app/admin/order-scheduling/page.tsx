import { FileCheck, Phone, Truck, Package } from "lucide-react";
import {
  getOrderSchedulingSummary,
  listSellerOrdersForAdmin,
  resolveOrderItemImageUrls,
} from "@kisan4u/orders";
import type {
  OrderStatus,
  UserRole,
  DeliveryMethod,
  PaymentStatus,
  PaymentMethod,
} from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireOrdersSectionView } from "@/lib/order-scheduling-guard";
import { buildAdminOrderRow } from "@/lib/admin-order-row";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
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
const TAB_VALUES = new Set(["all", "awaitingConfirmation", "readyToSchedule", "labelsReady", "pickupScheduled"]);

/**
 * The "Scheduling Team" role's entry point: the exact same order table an
 * admin sees on /admin/orders (same data, same inline Confirm / status
 * control), and every row's "View" opens the full /admin/orders/[id]
 * detail page. The Scheduling Team role has full working access to the
 * orders section — see order-scheduling-guard.ts.
 *
 * The reference design also called for a call-outcome workflow (Needs
 * calling / Follow-up due / Awaiting call, with per-order call logging)
 * and live courier-API exception tracking — neither has any backing data
 * model in this codebase (no call-log table, and a failed shipment API
 * call never persists a row to list later), so those specific tabs
 * aren't included here; the tabs below are limited to signals this
 * system actually tracks (confirmation status, shipment/label presence).
 */
export default async function OrderSchedulingPage({
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
      status: tab === "pickupScheduled" ? "PICKUP_SCHEDULED" : status,
      statusGroup: tab === "awaitingConfirmation" ? "new" : undefined,
      readyToSchedule: tab === "readyToSchedule" ? true : undefined,
      hasLabel: tab === "labelsReady" ? true : undefined,
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
    getOrderSchedulingSummary(),
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
      ? `/admin/order-scheduling?${params.toString()}`
      : "/admin/order-scheduling";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", href: tabHref("all") },
    {
      key: "awaitingConfirmation",
      label: "Awaiting confirmation",
      count: summary.awaitingConfirmation,
      href: tabHref("awaitingConfirmation"),
    },
    {
      key: "readyToSchedule",
      label: "Ready to schedule",
      count: summary.readyToSchedule,
      href: tabHref("readyToSchedule"),
    },
    { key: "labelsReady", label: "Labels ready", count: summary.labelsReady, href: tabHref("labelsReady") },
    {
      key: "pickupScheduled",
      label: "Pickup scheduled",
      count: summary.pickupScheduled,
      href: tabHref("pickupScheduled"),
    },
  ];

  return (
    <PageContainer maxWidth="1400px" className="py-10">
      <PageHeader
        title="Order Scheduling"
        description="Confirm buyers, create shipments and download labels."
      />

      <StatCardsRow>
        <StatCard icon={<Phone className="h-5 w-5" aria-hidden="true" />} label="Awaiting confirmation" value={summary.awaitingConfirmation} tone={summary.awaitingConfirmation > 0 ? "amber" : "neutral"} />
        <StatCard icon={<Truck className="h-5 w-5" aria-hidden="true" />} label="Ready to schedule" value={summary.readyToSchedule} tone="blue" />
        <StatCard icon={<FileCheck className="h-5 w-5" aria-hidden="true" />} label="Labels ready" value={summary.labelsReady} tone="green" />
        <StatCard icon={<Package className="h-5 w-5" aria-hidden="true" />} label="Pickup scheduled" value={summary.pickupScheduled} />
      </StatCardsRow>

      <StatusTabs items={tabs} activeKey={tab} />

      <OrdersTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        viewBasePath="/admin/orders"
        showInlineStatus
      />
    </PageContainer>
  );
}
