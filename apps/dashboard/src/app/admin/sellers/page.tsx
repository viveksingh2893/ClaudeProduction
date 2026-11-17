import { Ban, CheckCircle2, Clock3, IndianRupee, ShoppingBag } from "lucide-react";
import type { ApplicationStatus } from "@kisan4u/db";
import { getFullName, prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { getSellerApplicationsSummary, listSellerApplications } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { SellersTable } from "./sellers-table";

const STATUS_VALUES: ApplicationStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

export default async function AdminSellersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const status = STATUS_VALUES.includes(sp.status as ApplicationStatus)
    ? (sp.status as ApplicationStatus)
    : undefined;
  const isActive = sp.active === "yes" ? true : sp.active === "no" ? false : undefined;

  const [{ rows: sellers, total }, summary] = await Promise.all([
    listSellerApplications({
      q: sp.q,
      status,
      isActive,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    getSellerApplicationsSummary(),
  ]);

  // Batch-fetched per-seller order count + sales sum for the current
  // page's rows only — not the whole table (that's what the summary
  // cards are for) — same batching convention as the dealer wallet
  // lookup in admin/dealers/page.tsx.
  const salesBySeller = await prisma.sellerOrder.groupBy({
    by: ["sellerId"],
    where: { sellerId: { in: sellers.map((s) => s.id) }, status: { not: "CANCELLED" } },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  const orderCountBySellerId = new Map(salesBySeller.map((s) => [s.sellerId, s._count._all]));
  const salesValueBySellerId = new Map(
    salesBySeller.map((s) => [s.sellerId, Number(s._sum.totalAmount ?? 0)]),
  );

  // SellerProfile carries Decimal columns (commissionPercent, ...) that
  // aren't plain-serializable across the Server -> Client boundary — see
  // the same fix in admin/orders/page.tsx. Trim to what SellersTable renders.
  const rows = sellers.map((s) => ({
    id: s.id,
    user: {
      id: s.user.id,
      name: getFullName(s.user) ?? s.user.email ?? "—",
      email: s.user.email,
      isActive: s.user.isActive,
      deletionRequestedAt: s.user.deletionRequestedAt,
      deletionScheduledFor: s.user.deletionScheduledFor,
      deletionStatus: toActiveDeletionStatus(s.user.accountDeletionRequests[0]?.status),
    },
    shopName: s.shopName,
    gstNumber: s.gstNumber,
    status: s.status,
    orderCount: orderCountBySellerId.get(s.id) ?? 0,
    salesValue: salesValueBySellerId.get(s.id) ?? 0,
  }));

  function tabHref(tabStatus?: ApplicationStatus) {
    const params = new URLSearchParams();
    if (tabStatus) params.set("status", tabStatus);
    return params.toString() ? `/admin/sellers?${params.toString()}` : "/admin/sellers";
  }

  const tabs: StatusTabItem[] = [
    { key: "ALL", label: "All", count: summary.total, href: tabHref() },
    { key: "APPROVED", label: "Approved", count: summary.approved, href: tabHref("APPROVED") },
    { key: "PENDING", label: "Pending", count: summary.pending, href: tabHref("PENDING") },
    { key: "REJECTED", label: "Rejected", count: summary.rejected, href: tabHref("REJECTED") },
    { key: "SUSPENDED", label: "Suspended", count: summary.suspended, href: tabHref("SUSPENDED") },
  ];

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader
        title="Sellers"
        description="Approved sellers with no live products or an unsettled payout are flagged below."
      />

      <StatCardsRow>
        <StatCard
          icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />}
          label="Total sellers"
          value={summary.total}
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          label="Active sellers"
          value={summary.activeSellers}
          tone="green"
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Pending"
          value={summary.pending}
          tone="amber"
        />
        <StatCard
          icon={<Ban className="h-5 w-5" aria-hidden="true" />}
          label="Suspended / Rejected"
          value={summary.suspended + summary.rejected}
          tone="red"
        />
        <StatCard
          icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
          label="Seller-generated sales"
          value={`₹${summary.salesValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.pending > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.pending} seller application${summary.pending === 1 ? "" : "s"} awaiting review`}
            href={tabHref("PENDING")}
            linkLabel="Review pending"
          />
        )}
        {summary.noLiveProductsCount > 0 && (
          <AlertBanner
            tone="blue"
            title={`${summary.noLiveProductsCount} approved seller${summary.noLiveProductsCount === 1 ? " has" : "s have"} no live products`}
            description="Nothing for a customer to buy from them yet."
          />
        )}
        {summary.settlementsDueCount > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.settlementsDueCount} seller${summary.settlementsDueCount === 1 ? "" : "s"} eligible for payout`}
            description="Settlement hold period has passed — payout not yet processed."
            href="/admin/settlements"
            linkLabel="Go to settlements"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={status ?? "ALL"} />

      <SellersTable sellers={rows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
