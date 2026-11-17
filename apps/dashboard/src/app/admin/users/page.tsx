import { Clock3, UserCheck, UserX, Users as UsersIcon } from "lucide-react";
import type { UserRole } from "@kisan4u/db";
import { getFullName, prisma } from "@kisan4u/db";
import { PageContainer, PageHeader } from "@kisan4u/ui";
import { getUsersDirectorySummary, listUsers } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";
import { StatCard, StatCardsRow } from "@/components/admin/stat-cards";
import { AlertBanner, AlertBannerStack } from "@/components/admin/alert-banner";
import { StatusTabs, type StatusTabItem } from "@/components/admin/status-tabs";
import { toActiveDeletionStatus } from "@/components/admin/deletion-status-badge";
import { UsersTable } from "./users-table";
import { AddUserMenu } from "./add-user-menu";

const ROLE_VALUES: UserRole[] = [
  "ADMIN",
  "SELLER",
  "DEALER",
  "CUSTOMER",
  "BUSINESS_ASSOCIATE",
  "DELIVERY_MAN",
  "STAFF",
];

const ROLE_TAB_LABEL: Record<UserRole, string> = {
  CUSTOMER: "Customers",
  DEALER: "Dealers",
  SELLER: "Sellers",
  BUSINESS_ASSOCIATE: "Business Associates",
  ADMIN: "Admins",
  DELIVERY_MAN: "Delivery",
  STAFF: "Employees",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession(["ADMIN"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;
  const role = ROLE_VALUES.includes(sp.role as UserRole) ? (sp.role as UserRole) : undefined;
  const isActive = sp.status === "active" ? true : sp.status === "inactive" ? false : undefined;

  const [{ rows: rawRows, total }, summary] = await Promise.all([
    listUsers({
      q: sp.q,
      role,
      isActive,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      sortKey: sp.sort,
      sortDir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
      page,
      pageSize,
    }),
    getUsersDirectorySummary(),
  ]);

  // Batch-fetched role-specific "assignment" + "approval state" info for
  // just this page's rows — same batching convention as the wallet-
  // balance merge on the Dealers page (no single Prisma query spans
  // User + DealerProfile + SellerProfile + BusinessAssociateProfile +
  // AdminProfile at once, since each is its own model keyed on userId).
  const ids = rawRows.map((u) => u.id);
  const [dealerProfiles, sellerProfiles, baProfiles, adminProfiles] = await Promise.all([
    prisma.dealerProfile.findMany({
      where: { userId: { in: ids } },
      select: { id: true, userId: true, storeName: true, city: true, state: true, status: true },
    }),
    prisma.sellerProfile.findMany({
      where: { userId: { in: ids } },
      select: { id: true, userId: true, shopName: true, status: true },
    }),
    prisma.businessAssociateProfile.findMany({
      where: { userId: { in: ids } },
      select: { id: true, userId: true, referralCode: true, status: true },
    }),
    prisma.adminProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, roleName: true },
    }),
  ]);
  const dealerByUserId = new Map(dealerProfiles.map((d) => [d.userId, d]));
  const sellerByUserId = new Map(sellerProfiles.map((s) => [s.userId, s]));
  const baByUserId = new Map(baProfiles.map((b) => [b.userId, b]));
  const adminByUserId = new Map(adminProfiles.map((a) => [a.userId, a]));

  const rows = rawRows.map((u) => {
    const { accountDeletionRequests, ...user } = u;
    const dealer = dealerByUserId.get(u.id);
    const seller = sellerByUserId.get(u.id);
    const ba = baByUserId.get(u.id);
    const admin = adminByUserId.get(u.id);
    const assignment =
      u.role === "DEALER"
        ? (dealer?.storeName ?? [dealer?.city, dealer?.state].filter(Boolean).join(", ")) || "—"
        : u.role === "SELLER"
          ? (seller?.shopName ?? "—")
          : u.role === "BUSINESS_ASSOCIATE"
            ? (ba?.referralCode ?? "—")
            : u.role === "ADMIN" || u.role === "STAFF"
              ? (admin?.roleName ?? "—")
              : "—";
    const approvalState = dealer?.status ?? seller?.status ?? ba?.status ?? null;
    // The three per-role admin detail pages are keyed by their own
    // profile id, not User.id (see DealerProfile/SellerProfile/
    // BusinessAssociateProfile — dealers/[id], sellers/[id], and
    // business-associates/[id] each look up by their own model's id).
    // Customers have no separate profile model, so customers/[id] is
    // keyed by User.id directly.
    const detailId =
      u.role === "DEALER"
        ? dealer?.id
        : u.role === "SELLER"
          ? seller?.id
          : u.role === "BUSINESS_ASSOCIATE"
            ? ba?.id
            : u.role === "CUSTOMER"
              ? u.id
              : undefined;
    return {
      ...user,
      name: getFullName(u) ?? u.phone ?? "—",
      deletionStatus: toActiveDeletionStatus(accountDeletionRequests[0]?.status),
      assignment,
      approvalState,
      lastActivityAt: u.updatedAt,
      detailId,
    };
  });

  function tabHref(tabRole?: UserRole) {
    const params = new URLSearchParams();
    if (tabRole) params.set("role", tabRole);
    return params.toString() ? `/admin/users?${params.toString()}` : "/admin/users";
  }

  const tabs: StatusTabItem[] = [
    { key: "ALL", label: "All", count: summary.total, href: tabHref() },
    ...ROLE_VALUES.map((r) => ({ key: r, label: ROLE_TAB_LABEL[r], href: tabHref(r) })),
  ];

  return (
    <PageContainer className="py-8" maxWidth="1200px">
      <PageHeader
        title="Users"
        description="Master directory of every account on the platform — customers, dealers, sellers, Business Associates, employees, and admins."
        actions={<AddUserMenu />}
      />

      <StatCardsRow>
        <StatCard icon={<UsersIcon className="h-5 w-5" aria-hidden="true" />} label="Total accounts" value={summary.total} />
        <StatCard
          icon={<UserCheck className="h-5 w-5" aria-hidden="true" />}
          label="Active"
          value={summary.active}
          tone="green"
        />
        <StatCard
          icon={<UsersIcon className="h-5 w-5" aria-hidden="true" />}
          label="New (30 days)"
          value={summary.newLast30Days}
          tone="blue"
        />
        <StatCard
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          label="Pending approval"
          value={summary.pendingApproval}
          tone="amber"
        />
        <StatCard
          icon={<UserX className="h-5 w-5" aria-hidden="true" />}
          label="Inactive (internal)"
          value={summary.inactiveInternal}
          tone="red"
        />
      </StatCardsRow>

      <AlertBannerStack>
        {summary.pendingApproval > 0 && (
          <AlertBanner
            tone="amber"
            title={`${summary.pendingApproval} application${summary.pendingApproval === 1 ? "" : "s"} awaiting approval`}
            description="Across dealers, sellers, and Business Associates."
          />
        )}
      </AlertBannerStack>

      <StatusTabs items={tabs} activeKey={role ?? "ALL"} />

      <UsersTable users={rows} total={total} page={page} pageSize={pageSize} />
    </PageContainer>
  );
}
