import { AlertTriangle, CalendarClock, IndianRupee, ShoppingCart, Users } from "lucide-react";
import type { OrderStatus, UserRole, PaymentStatus, PaymentMethod } from "@kisan4u/db";
import {
  getCheckoutGroupsSummary,
  listCheckoutGroupsForAdmin,
  type AdminCheckoutGroupTab,
} from "@kisan4u/orders";
import { prisma, getFullName } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { ORDER_STATUS_LABEL } from "@/lib/order-status-labels";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { CheckoutGroupsTable } from "./checkout-groups-table";

const ORDER_STATUSES: OrderStatus[] = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];
const CUSTOMER_TYPES: UserRole[] = ["CUSTOMER", "DEALER"];
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
const TAB_VALUES = new Set(["all", "active", "needsAttention", "multiSeller", "completed", "cancelled"]);

export default async function AdminCheckoutGroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
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
  const paymentStatus = PAYMENT_STATUSES.includes(sp.paymentStatus as PaymentStatus)
    ? (sp.paymentStatus as PaymentStatus)
    : undefined;
  const paymentMethod = PAYMENT_METHODS.includes(sp.paymentMethod as PaymentMethod)
    ? (sp.paymentMethod as PaymentMethod)
    : undefined;

  const [sellers, states, { rows: groups, total }, summary] = await Promise.all([
    prisma.sellerProfile.findMany({
      where: { status: "APPROVED" },
      select: { id: true, shopName: true },
      orderBy: { shopName: "asc" },
    }),
    prisma.indianState.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listCheckoutGroupsForAdmin({
      status,
      customerType,
      paymentStatus,
      paymentMethod,
      tab: tab === "all" ? undefined : (tab as AdminCheckoutGroupTab),
      state: sp.state || undefined,
      sellerId: sp.sellerId || undefined,
      search: sp.q || undefined,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    getCheckoutGroupsSummary(),
  ]);

  // Decimal/relation-heavy rows aren't plain-serializable across the
  // Server -> Client boundary — trim to exactly what the table renders,
  // same convention as admin/orders/page.tsx.
  const rows = groups.map((g) => ({
    id: g.id,
    groupNumber: g.groupNumber,
    createdAt: g.createdAt,
    // CheckoutGroup.customerType is stored as the general UserRole enum,
    // but a checkout group is only ever created for a CUSTOMER or DEALER
    // session (see packages/orders/src/checkout.ts's CheckoutContext) —
    // narrowed here since the table only ever needs to render these two.
    customerType: g.customerType as "CUSTOMER" | "DEALER",
    customer: {
      id: g.customer.id,
      name: getFullName(g.customer) ?? g.customer.phone ?? "—",
      phone: g.customer.phone,
      email: g.customer.email,
    },
    state: g.addressSnapshot?.state ?? null,
    orderCount: g.orderCount,
    sellerCount: g.sellerCount,
    itemCount: g.itemCount,
    totalAmount: g.totalAmount,
    paymentMethod: g.primaryPayment?.method ?? null,
    paymentStatus: g.primaryPayment?.status ?? null,
    paidSoFar: g.primaryPayment ? Number(g.primaryPayment.amountPaid) : 0,
    distinctStatuses: g.distinctStatuses,
    needsAttention: g.needsAttention,
    sellerOrders: g.sellerOrders.map((so) => ({
      id: so.id,
      orderNumber: so.orderNumber,
      sellerName: so.seller.shopName,
      itemCount: so.items.length,
      totalAmount: Number(so.totalAmount),
      status: so.status,
    })),
  }));

  function tabHref(tabKey: string) {
    const params = new URLSearchParams();
    if (tabKey !== "all") params.set("tab", tabKey);
    return params.toString() ? `/admin/checkout-groups?${params.toString()}` : "/admin/checkout-groups";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", count: summary.total, href: tabHref("all") },
    { key: "active", label: "Active", href: tabHref("active") },
    {
      key: "needsAttention",
      label: "Needs attention",
      count: summary.needsAttention,
      href: tabHref("needsAttention"),
    },
    {
      key: "multiSeller",
      label: "Multi-seller",
      count: summary.multiSeller,
      href: tabHref("multiSeller"),
    },
    { key: "completed", label: "Completed", href: tabHref("completed") },
    { key: "cancelled", label: "Cancelled", href: tabHref("cancelled") },
  ];

  return (
    <PageContainer className="py-8" maxWidth="1400px">
      <PageHeader
        title="Checkout Groups"
        description="Track every buyer checkout and its seller-specific orders."
      />

      <StatCardsRow>
        <StatCard icon={<ShoppingCart className="h-5 w-5" aria-hidden="true" />} label="Total checkouts" value={summary.total} />
        <StatCard icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />} label="Checkouts today" value={summary.today} tone="blue" />
        <StatCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          label="Multi-seller"
          value={summary.multiSeller}
          hint={`${summary.total > 0 ? ((summary.multiSeller / summary.total) * 100).toFixed(1) : 0}% split across sellers`}
        />
        <StatCard icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />} label="Checkout value" value={`₹${(summary.checkoutValue / 100000).toFixed(1)}L`} />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label="Needs attention"
          value={summary.needsAttention}
          tone={summary.needsAttention > 0 ? "red" : "neutral"}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.needsAttention > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.needsAttention} checkout${summary.needsAttention === 1 ? "" : "s"} need attention`}
            description="A seller order is awaiting payment verification or has a delivery problem — Cash on Delivery still pending is not counted here."
            href={tabHref("needsAttention")}
            linkLabel="Review"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />

      <CheckoutGroupsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sellers={sellers}
        states={states}
      />
    </PageContainer>
  );
}
