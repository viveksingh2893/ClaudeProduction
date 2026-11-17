import { Ban, Clock3, IndianRupee, ShieldAlert, Users } from "lucide-react";
import type { BaStatus } from "@kisan4u/db";
import {
  getBaEarningsSummaryByIds,
  getBaProgramSummary,
  listBusinessAssociates,
} from "@kisan4u/orders";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { requireSession } from "@/lib/session-guard";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { BaTable } from "./ba-table";

const STATUS_VALUES: BaStatus[] = [
  "PENDING",
  "APPROVED",
  "BANK_SUBMITTED",
  "REJECTED",
  "SUSPENDED",
];

export default async function AdminBaListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const status = STATUS_VALUES.includes(sp.status as BaStatus)
    ? (sp.status as BaStatus)
    : undefined;
  const isActive = sp.active === "yes" ? true : sp.active === "no" ? false : undefined;

  const [{ rows: bas, total }, summary] = await Promise.all([
    listBusinessAssociates({
      q: sp.q,
      status,
      isActive,
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    getBaProgramSummary(),
  ]);
  const earningsById = await getBaEarningsSummaryByIds(bas.map((b) => b.id));

  const rows = bas.map((b) => {
    const earnings = earningsById.get(b.id) ?? {
      totalCommission: 0,
      redeemableCommission: 0,
      referredOrders: 0,
      referredSales: 0,
    };
    return {
      id: b.id,
      userId: b.userId,
      referralCode: b.referralCode,
      userName: b.userName,
      contactNumber: b.contactNumber,
      status: b.status,
      userIsActive: b.userIsActive,
      deletionRequestedAt: b.deletionRequestedAt,
      deletionScheduledFor: b.deletionScheduledFor,
      deletionStatus: toActiveDeletionStatus(b.deletionStatus),
      referredCount: b.referredCount,
      referredOrders: earnings.referredOrders,
      referredSales: earnings.referredSales,
      totalCommission: earnings.totalCommission,
      redeemableCommission: earnings.redeemableCommission,
      hasBankDetails: b.hasBankDetails,
      panNumber: b.panNumber,
    };
  });

  function tabHref(tabStatus?: BaStatus) {
    const params = new URLSearchParams();
    if (tabStatus) params.set("status", tabStatus);
    return params.toString()
      ? `/admin/business-associates?${params.toString()}`
      : "/admin/business-associates";
  }

  const tabs: StatusTabItem[] = [
    { key: "ALL", label: "All", count: summary.total, href: tabHref() },
    {
      key: "APPROVED",
      label: "Approved",
      count: summary.approved,
      href: tabHref("BANK_SUBMITTED"),
    },
    { key: "PENDING", label: "Pending", count: summary.pending, href: tabHref("PENDING") },
    { key: "REJECTED", label: "Rejected", count: summary.rejected, href: tabHref("REJECTED") },
    { key: "SUSPENDED", label: "Suspended", count: summary.suspended, href: tabHref("SUSPENDED") },
  ];
  const activeTabKey =
    status === "APPROVED" || status === "BANK_SUBMITTED" ? "APPROVED" : (status ?? "ALL");

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader
        title="Business Associates"
        description="Referral partners who earn commission on customers and dealers they bring in."
      />

      <StatCardsRow>
        <StatCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          label="Total BAs"
          value={summary.total}
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Pending approval"
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
          icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
          label="Missing bank / PAN"
          value={summary.missingBankOrPanCount}
          tone="amber"
        />
        <StatCard
          icon={<IndianRupee className="h-5 w-5" aria-hidden="true" />}
          label="Payouts due"
          value={summary.payoutsDueCount}
          tone={summary.payoutsDueCount > 0 ? "amber" : "neutral"}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.pending > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.pending} BA application${summary.pending === 1 ? "" : "s"} awaiting review`}
            href={tabHref("PENDING")}
            linkLabel="Review pending"
          />
        )}
        {summary.inactiveCount > 0 && (
          <AlertBanner
            tone="blue"
            title={`${summary.inactiveCount} BA account${summary.inactiveCount === 1 ? " is" : "s are"} inactive`}
          />
        )}
        {summary.payoutsDueCount > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.payoutsDueCount} BA${summary.payoutsDueCount === 1 ? "" : "s"} have redeemable commission awaiting payout`}
            href="/admin/ba-settlements"
            linkLabel="Go to BA settlements"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={activeTabKey} />

      <BaTable bas={rows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
