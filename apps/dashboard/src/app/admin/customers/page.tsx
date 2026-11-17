import { IndianRupee, RefreshCw, TrendingUp, Users as UsersIcon } from "lucide-react";
import { prisma, getFullName } from "@kisan4u/db";
import { getCustomerDirectorySummary, listCustomers } from "@kisan4u/auth";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { CustomersTable } from "./customers-table";
import type { CustomerDealerApplicationStatus } from "./convert-to-dealer-button";

const TAB_VALUES = new Set(["all", "missingState", "noOrders"]);

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const isActive = sp.active === "yes" ? true : sp.active === "no" ? false : undefined;
  const tab = TAB_VALUES.has(sp.tab ?? "") ? (sp.tab as "all" | "missingState" | "noOrders") : "all";

  const [{ rows: customers, total }, summary] = await Promise.all([
    listCustomers({
      q: sp.q,
      isActive,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      stateId: sp.state,
      tab: tab === "all" ? undefined : tab,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    getCustomerDirectorySummary(),
  ]);

  const activeStates = await prisma.indianState.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const customerIds = customers.map((c) => c.id);

  // Batch-fetched for just this page of rows, not per-row and not for the
  // whole customer table — same convention as the Dealers page's own
  // wallet-balance merge (Wallet.ownerId has no Prisma relation to join
  // through, see packages/orders/src/wallet.ts) plus a groupBy for total
  // spent / last-order-date, both scoped to `customerIds` so this never
  // scans more than one page's worth of order history.
  const [wallets, orderAggregates, dealerApplications] = await Promise.all([
    prisma.wallet.findMany({
      where: { ownerId: { in: customerIds } },
      select: { ownerId: true, balance: true },
    }),
    prisma.sellerOrder.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds } },
      _sum: { totalAmount: true },
      _max: { createdAt: true },
    }),
    // A CUSTOMER-role account can carry a PENDING / REJECTED DealerProfile
    // (they applied to "become a dealer" but aren't approved yet) — surface
    // it so the row's action reads "Edit dealer application" instead of
    // "Convert to dealer".
    prisma.dealerProfile.findMany({
      where: { userId: { in: customerIds } },
      select: { userId: true, status: true },
    }),
  ]);
  const walletByUserId = new Map(wallets.map((w) => [w.ownerId, Number(w.balance)]));
  const dealerApplicationByUserId = new Map(
    dealerApplications.map((d) => [d.userId, d.status]),
  );
  const orderStatsByUserId = new Map(
    orderAggregates.map((a) => [
      a.customerId,
      { totalSpent: Number(a._sum.totalAmount ?? 0), lastOrderAt: a._max.createdAt },
    ]),
  );

  const rows = customers.map((c) => {
    const { accountDeletionRequests, ...customer } = c;
    return {
      ...customer,
      name: getFullName(c) ?? c.phone ?? "—",
      deletionStatus: toActiveDeletionStatus(accountDeletionRequests[0]?.status),
      stateName: c.indianState?.name ?? null,
      totalOrders: c._count.sellerOrders,
      totalSpent: orderStatsByUserId.get(c.id)?.totalSpent ?? 0,
      lastOrderAt: orderStatsByUserId.get(c.id)?.lastOrderAt ?? null,
      walletBalance: walletByUserId.get(c.id) ?? 0,
      dealerApplicationStatus: (dealerApplicationByUserId.get(c.id) ??
        "NONE") as CustomerDealerApplicationStatus,
    };
  });

  function tabHref(tabKey: "all" | "missingState" | "noOrders") {
    const params = new URLSearchParams();
    if (tabKey !== "all") params.set("tab", tabKey);
    return params.toString() ? `/admin/customers?${params.toString()}` : "/admin/customers";
  }

  const tabs: StatusTabItem[] = [
    { key: "all", label: "All", count: summary.total, href: tabHref("all") },
    {
      key: "missingState",
      label: "Missing state",
      count: summary.missingStateCount,
      href: tabHref("missingState"),
    },
    {
      key: "noOrders",
      label: "Registered, no orders",
      count: summary.registeredNoOrdersCount,
      href: tabHref("noOrders"),
    },
  ];

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader
        title="Customers"
        description="Customer accounts — order history, spend, and wallet balance at a glance."
      />

      <StatCardsRow>
        <StatCard icon={<UsersIcon className="h-5 w-5" aria-hidden="true" />} label="Total customers" value={summary.total} />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
          label="New (30 days)"
          value={summary.newLast30Days}
          tone="green"
        />
        <StatCard
          icon={<UsersIcon className="h-5 w-5" aria-hidden="true" />}
          label="Active buyers (30 days)"
          value={summary.activeBuyers}
          tone="blue"
        />
        <StatCard
          icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
          label="Revenue (all time)"
          value={`₹${summary.revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        />
        <StatCard
          icon={<RefreshCw className="h-5 w-5" aria-hidden="true" />}
          label="Repeat purchase rate"
          value={`${summary.repeatPurchaseRatePercent.toFixed(1)}%`}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.missingStateCount > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.missingStateCount} customer${summary.missingStateCount === 1 ? "" : "s"} haven't selected a state`}
            description="They can't see state-restricted products until this is set."
            href={tabHref("missingState")}
            linkLabel="Review"
          />
        )}
        {summary.registeredNoOrdersCount > 0 && (
          <AlertBanner
            tone="blue"
            title={`${summary.registeredNoOrdersCount} customer${summary.registeredNoOrdersCount === 1 ? " has" : "s have"} registered but never ordered`}
            href={tabHref("noOrders")}
            linkLabel="Review"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={tab} />

      <CustomersTable
        customers={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        states={activeStates}
      />
    </PageContainer>
  );
}
