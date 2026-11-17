import { AlertTriangle, Ban, CheckCircle2, Clock3, Store } from "lucide-react";
import type { ApplicationStatus } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { getDealerApplicationsSummary, listDealerApplications } from "@kisan4u/auth";
import { prisma, getFullName } from "@kisan4u/db";
import { requireSession } from "@/lib/session-guard";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { DealersTable } from "./dealers-table";

const STATUS_VALUES: ApplicationStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

export default async function AdminDealersPage({
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
  const missingDocuments = sp.missingDocuments === "yes" ? true : undefined;

  const [{ rows: dealers, total }, states, summary] = await Promise.all([
    listDealerApplications({
      q: sp.q,
      status,
      stateId: sp.state || undefined,
      isActive,
      missingDocuments,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    prisma.indianState.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getDealerApplicationsSummary(),
  ]);

  // Batch-fetched, not per-row — Wallet.ownerId is the dealer's User.id,
  // no Prisma relation to join through (see packages/orders/src/wallet.ts).
  const wallets = await prisma.wallet.findMany({
    where: { ownerId: { in: dealers.map((d) => d.user.id) } },
    select: { ownerId: true, balance: true, loyaltyPoints: true },
  });
  const walletBalanceByUserId = new Map(wallets.map((w) => [w.ownerId, Number(w.balance)]));
  const loyaltyPointsByUserId = new Map(wallets.map((w) => [w.ownerId, w.loyaltyPoints]));
  const dealersWithWallet = dealers.map((d) => {
    const { accountDeletionRequests, ...user } = d.user;
    return {
      ...d,
      user: {
        ...user,
        name: getFullName(d.user) ?? d.user.phone ?? "—",
        deletionStatus: toActiveDeletionStatus(accountDeletionRequests[0]?.status),
      },
      walletBalance: walletBalanceByUserId.get(d.user.id) ?? 0,
      loyaltyPoints: loyaltyPointsByUserId.get(d.user.id) ?? 0,
    };
  });

  function tabHref(tabStatus?: ApplicationStatus) {
    const params = new URLSearchParams();
    if (tabStatus) params.set("status", tabStatus);
    return params.toString() ? `/admin/dealers?${params.toString()}` : "/admin/dealers";
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
        title="Dealers"
        description="Dealers pick their state once at registration and cannot change it themselves afterward — only an admin can, here."
      />

      <StatCardsRow>
        <StatCard icon={<Store className="h-5 w-5" aria-hidden="true" />} label="Total dealers" value={summary.total} />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          label="Approved"
          value={summary.approved}
          tone="green"
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Pending"
          value={summary.pending}
          tone="amber"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label="Rejected"
          value={summary.rejected}
          tone="red"
        />
        <StatCard
          icon={<Ban className="h-5 w-5" aria-hidden="true" />}
          label="Suspended"
          value={summary.suspended}
          tone="red"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          label="Missing documents"
          value={summary.missingDocumentsCount}
          tone={summary.missingDocumentsCount > 0 ? "amber" : undefined}
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.stalePendingCount > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.stalePendingCount} dealer application${summary.stalePendingCount === 1 ? "" : "s"} pending for 3+ days`}
            description="These applications have been waiting longer than usual — review them first."
            href={tabHref("PENDING")}
            linkLabel="Review pending"
          />
        )}
        {summary.missingDocumentsCount > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.missingDocumentsCount} approved dealer${summary.missingDocumentsCount === 1 ? "" : "s"} missing a GST or licence document`}
            description="Migrated from the legacy site without a recoverable document — kept approved since it wasn't their fault. Upload the missing document on each profile to clear the flag."
            href="/admin/dealers?status=APPROVED&missingDocuments=yes"
            linkLabel="Review missing documents"
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={status ?? "ALL"} />

      <DealersTable
        dealers={dealersWithWallet}
        states={states}
        total={total}
        page={page}
        pageSize={pageSize}
      />
    </PageContainer>
  );
}
