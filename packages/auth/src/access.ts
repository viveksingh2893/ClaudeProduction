import { prisma, ApplicationStatus, KycStatus, Prisma, UserRole } from "@kisan4u/db";
import {
  applicationDecisionSchema,
  userActiveToggleSchema,
  sellerCommissionInputSchema,
  maskIndianPhone,
} from "@kisan4u/validators";
import type {
  ApplicationDecisionInput,
  UserActiveToggleInput,
  SellerCommissionInput,
} from "@kisan4u/validators";
import { getSmsProvider } from "@kisan4u/providers";
import { getFullName } from "@kisan4u/db";
import { adminResetPassword } from "./password-reset";

/**
 * Server-side approval-status reads, meant to be called directly inside
 * protected page components (Node context) — NOT from middleware, which
 * runs on the Edge runtime and has no DB access. This is the actual
 * enforcement point for "pending/rejected/suspended dealers and sellers
 * must not access protected role pages": middleware only proves the user
 * is logged in, these functions prove their application is APPROVED,
 * re-checked fresh from the database on every page load.
 */
export async function getDealerProfileForUser(userId: string) {
  return prisma.dealerProfile.findUnique({ where: { userId } });
}

export async function getSellerProfileForUser(userId: string) {
  return prisma.sellerProfile.findUnique({ where: { userId } });
}

/**
 * The Phase 2 session-revocation check. The JWT carries a snapshot of
 * `sessionVersion` from whenever it was last issued; this compares that
 * snapshot against the live column, which every admin mutation below
 * increments. A mismatch means an admin acted on this account (approve/
 * reject/suspend/reinstate/activate/deactivate) *after* the session was
 * issued — the JWT itself is still validly signed and unexpired, but the
 * account state it was issued for no longer holds, so it must be
 * rejected. Also fails closed if the user was deleted or deactivated.
 *
 * Must be called from Node-context pages/actions on every protected
 * request — middleware (Edge runtime) has no DB access and cannot do
 * this check itself.
 */
export async function validateUserSession(
  userId: string,
  tokenSessionVersion: number,
  mobileSessionId?: string | null,
): Promise<
  | { valid: true; mustChangePassword: boolean }
  | {
      valid: false;
      reason: "not_found" | "inactive" | "revoked" | "deletion_pending" | "mobile_session_revoked";
    }
> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      sessionVersion: true,
      mustChangePassword: true,
      deletionRequestedAt: true,
      deletedAt: true,
      mobileSessions: {
        where: { id: mobileSessionId ?? "__legacy_token_without_session__" },
        select: { revokedAt: true },
        take: 1,
      },
    },
  });
  if (!user) return { valid: false, reason: "not_found" };
  if (user.deletedAt) return { valid: false, reason: "inactive" };
  if (user.deletionRequestedAt) return { valid: false, reason: "deletion_pending" };
  if (!user.isActive) return { valid: false, reason: "inactive" };
  if (user.sessionVersion !== tokenSessionVersion) return { valid: false, reason: "revoked" };
  if (mobileSessionId) {
    if (user.mobileSessions.length !== 1 || user.mobileSessions[0]?.revokedAt) {
      return { valid: false, reason: "mobile_session_revoked" };
    }
  }
  return { valid: true, mustChangePassword: user.mustChangePassword };
}

/**
 * Fresh basic identity fields for profile pages. Deliberately not read
 * from the JWT session — the session only carries id/role/firstName/lastName/email
 * (see packages/auth/src/types.d.ts), not phone, and a profile view
 * should show current DB state anyway, not a login-time snapshot.
 */
export async function getUserBasicInfo(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      role: true,
      isGuest: true,
      deletionRequestedAt: true,
      deletionScheduledFor: true,
      deletedAt: true,
    },
  });
}

export type AdminApplicationSortKey = "createdAt" | "status";

export type ListDealerApplicationsFilters = {
  q?: string;
  status?: ApplicationStatus;
  stateId?: string;
  isActive?: boolean;
  missingDocuments?: boolean;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

const ADMIN_DEALER_SORT: Record<
  AdminApplicationSortKey,
  keyof Prisma.DealerProfileOrderByWithRelationInput
> = {
  createdAt: "createdAt",
  status: "status",
};

export async function listDealerApplications(filters: ListDealerApplicationsFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortField =
    filters.sortKey && filters.sortKey in ADMIN_DEALER_SORT
      ? ADMIN_DEALER_SORT[filters.sortKey as AdminApplicationSortKey]
      : "createdAt";
  const sortDir = filters.sortDir ?? "desc";
  const q = filters.q?.trim();

  const where: Prisma.DealerProfileWhereInput = {
    user: {
      deletedAt: null,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.stateId ? { stateId: filters.stateId } : {}),
    ...(filters.missingDocuments !== undefined
      ? { hasMissingDocuments: filters.missingDocuments }
      : {}),
    ...(q
      ? {
          OR: [
            { user: { firstName: { contains: q, mode: "insensitive" as const } } },
            { user: { lastName: { contains: q, mode: "insensitive" as const } } },
            { user: { phone: { contains: q, mode: "insensitive" as const } } },
            { storeName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.dealerProfile.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            isActive: true,
            deletionRequestedAt: true,
            deletionScheduledFor: true,
            accountDeletionRequests: {
              where: { status: { in: ["PENDING_REVIEW", "SCHEDULED", "BLOCKED"] } },
              orderBy: { requestedAt: "desc" },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.dealerProfile.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type DealerApplicationsSummary = {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  suspended: number;
  /** PENDING for longer than STALE_PENDING_DAYS — no licence-expiry field exists on DealerProfile yet, so this is the one data-backed "needs attention" signal available today. */
  stalePendingCount: number;
  /** APPROVED dealers with a null gstDocUrl or licenseDocUrl — see DealerProfile.hasMissingDocuments. */
  missingDocumentsCount: number;
};

const STALE_PENDING_DAYS = 3;

/** Powers the Dealers list's stat cards + stale-pending alert banner — counts across the WHOLE table, not the current filter/tab, same convention as getPosOrdersSummaryForPlacedBy. */
export async function getDealerApplicationsSummary(): Promise<DealerApplicationsSummary> {
  const [grouped, stalePendingCount, missingDocumentsCount] = await Promise.all([
    prisma.dealerProfile.groupBy({ by: ["status"], _count: true }),
    prisma.dealerProfile.count({
      where: {
        status: "PENDING",
        createdAt: { lte: new Date(Date.now() - STALE_PENDING_DAYS * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.dealerProfile.count({ where: { hasMissingDocuments: true } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Record<
    ApplicationStatus,
    number
  >;
  return {
    total: grouped.reduce((sum, g) => sum + g._count, 0),
    approved: byStatus.APPROVED ?? 0,
    pending: byStatus.PENDING ?? 0,
    rejected: byStatus.REJECTED ?? 0,
    suspended: byStatus.SUSPENDED ?? 0,
    stalePendingCount,
    missingDocumentsCount,
  };
}

export type ListSellerApplicationsFilters = {
  q?: string;
  status?: ApplicationStatus;
  isActive?: boolean;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

const ADMIN_SELLER_SORT: Record<
  AdminApplicationSortKey,
  keyof Prisma.SellerProfileOrderByWithRelationInput
> = {
  createdAt: "createdAt",
  status: "status",
};

export async function listSellerApplications(filters: ListSellerApplicationsFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortField =
    filters.sortKey && filters.sortKey in ADMIN_SELLER_SORT
      ? ADMIN_SELLER_SORT[filters.sortKey as AdminApplicationSortKey]
      : "createdAt";
  const sortDir = filters.sortDir ?? "desc";
  const q = filters.q?.trim();
  const dateFilter =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.SellerProfileWhereInput = {
    user: {
      deletedAt: null,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    },
    ...(filters.status ? { status: filters.status } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(q
      ? {
          OR: [
            { user: { firstName: { contains: q, mode: "insensitive" as const } } },
            { user: { lastName: { contains: q, mode: "insensitive" as const } } },
            { user: { email: { contains: q, mode: "insensitive" as const } } },
            { shopName: { contains: q, mode: "insensitive" as const } },
            { gstNumber: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sellerProfile.findMany({
      where,
      select: {
        id: true,
        shopName: true,
        gstNumber: true,
        status: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
            deletionRequestedAt: true,
            deletionScheduledFor: true,
            accountDeletionRequests: {
              where: { status: { in: ["PENDING_REVIEW", "SCHEDULED", "BLOCKED"] } },
              orderBy: { requestedAt: "desc" },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerProfile.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type SellerApplicationsSummary = {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  suspended: number;
  /** APPROVED status AND account not disabled — the sellers actually able to transact right now. */
  activeSellers: number;
  /** Sum of SellerOrder.totalAmount across all non-cancelled orders placed with an APPROVED seller. */
  salesValue: number;
  /** APPROVED sellers with zero products at lifecycleStatus=APPROVED — nothing for a customer to actually buy from them. */
  noLiveProductsCount: number;
  /** Distinct sellers with at least one SellerSettlement at ELIGIBLE (hold period passed, payout not yet processed). */
  settlementsDueCount: number;
};

/** Powers the Sellers list's stat cards + pending/no-live-products/settlements-due alert banners — counts across the WHOLE table, not the current filter/tab, same convention as getDealerApplicationsSummary. */
export async function getSellerApplicationsSummary(): Promise<SellerApplicationsSummary> {
  const [grouped, activeSellers, salesAgg, approvedSellerIds, settlementsDueSellerIds] =
    await Promise.all([
      prisma.sellerProfile.groupBy({ by: ["status"], _count: true }),
      prisma.sellerProfile.count({ where: { status: "APPROVED", user: { isActive: true } } }),
      prisma.sellerOrder.aggregate({
        _sum: { totalAmount: true },
        where: { status: { not: "CANCELLED" }, seller: { status: "APPROVED" } },
      }),
      prisma.sellerProfile.findMany({
        where: {
          status: "APPROVED",
          products: { none: { lifecycleStatus: "APPROVED" } },
        },
        select: { id: true },
      }),
      prisma.sellerSettlement.findMany({
        where: { status: "ELIGIBLE" },
        select: { sellerId: true },
        distinct: ["sellerId"],
      }),
    ]);

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Record<
    ApplicationStatus,
    number
  >;
  return {
    total: grouped.reduce((sum, g) => sum + g._count, 0),
    approved: byStatus.APPROVED ?? 0,
    pending: byStatus.PENDING ?? 0,
    rejected: byStatus.REJECTED ?? 0,
    suspended: byStatus.SUSPENDED ?? 0,
    activeSellers,
    salesValue: Number(salesAgg._sum.totalAmount ?? 0),
    noLiveProductsCount: approvedSellerIds.length,
    settlementsDueCount: settlementsDueSellerIds.length,
  };
}

export type AdminUserSortKey = "name" | "role" | "createdAt";
// "name" can't be a single `keyof UserOrderByWithRelationInput` any more
// now that User.name is split into firstName/lastName — it's handled as a
// composite two-field orderBy below instead of through this lookup.
const ADMIN_USER_SORT: Partial<
  Record<AdminUserSortKey, keyof Prisma.UserOrderByWithRelationInput>
> = {
  role: "role",
  createdAt: "createdAt",
};

export type ListUsersFilters = {
  q?: string;
  role?: UserRole;
  isActive?: boolean;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

export async function listUsers(filters: ListUsersFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortKey: AdminUserSortKey =
    filters.sortKey && (filters.sortKey === "name" || filters.sortKey in ADMIN_USER_SORT)
      ? (filters.sortKey as AdminUserSortKey)
      : "createdAt";
  const sortDir = filters.sortDir ?? "desc";
  const orderBy: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[] =
    sortKey === "name"
      ? [{ firstName: sortDir }, { lastName: sortDir }]
      : { [ADMIN_USER_SORT[sortKey]!]: sortDir };

  const q = filters.q?.trim();
  const dateFilter =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
        accountDeletionRequests: {
          where: { status: { in: ["PENDING_REVIEW", "SCHEDULED", "BLOCKED"] } },
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type UsersDirectorySummary = {
  total: number;
  active: number;
  newLast30Days: number;
  /** PENDING dealer + seller + BA applications combined — the master directory's one cross-role "needs a decision" count. */
  pendingApproval: number;
  /** STAFF/ADMIN accounts with the account disabled — internal headcount that's off the roster right now. */
  inactiveInternal: number;
};

const USER_ACTIVITY_WINDOW_DAYS = 30;

/** Powers the Users master directory's stat cards — counts across every role, not the current filter/tab, same convention as the other admin list summaries. */
export async function getUsersDirectorySummary(): Promise<UsersDirectorySummary> {
  const cutoff = new Date(Date.now() - USER_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [
    total,
    active,
    newLast30Days,
    pendingDealers,
    pendingSellers,
    pendingBas,
    inactiveInternal,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { createdAt: { gte: cutoff } } }),
    prisma.dealerProfile.count({ where: { status: "PENDING" } }),
    prisma.sellerProfile.count({ where: { status: "PENDING" } }),
    prisma.businessAssociateProfile.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { role: { in: ["STAFF", "ADMIN"] }, isActive: false } }),
  ]);
  return {
    total,
    active,
    newLast30Days,
    pendingApproval: pendingDealers + pendingSellers + pendingBas,
    inactiveInternal,
  };
}

export type AdminCustomerSortKey = "name" | "createdAt";
// Same composite-orderBy handling as ADMIN_USER_SORT above — "name" isn't a
// single Prisma field any more.
const ADMIN_CUSTOMER_SORT: Partial<
  Record<AdminCustomerSortKey, keyof Prisma.UserOrderByWithRelationInput>
> = {
  createdAt: "createdAt",
};

export type ListCustomersFilters = {
  q?: string;
  isActive?: boolean;
  dateFrom?: string;
  dateTo?: string;
  /** Exact IndianState.id filter — "State not selected" is requested via the literal string "NONE" (no real state id ever collides with this). */
  stateId?: string;
  /** Quick-tab segment, applied on top of every other filter. */
  tab?: "missingState" | "noOrders";
  sortKey?: string | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  pageSize?: number;
};

/**
 * Customer/customer roster for the admin Customers page — mirrors
 * listDealerApplications' shape (rows/total/page/pageSize) but scoped to
 * `role: CUSTOMER` on the plain `User` table (customers have no separate
 * profile model the way dealers/sellers do). Deliberately selects only
 * account-identity fields here — order count, total spent, wallet balance,
 * and last-order date are page-scoped aggregates the caller (admin
 * customers/page.tsx) batches separately for just the current page of
 * rows, the same pattern dealers/page.tsx already uses for wallet
 * balance, so this function never needs to touch Order/Wallet tables
 * itself or return more than one page's worth of identity rows.
 */
export async function listCustomers(filters: ListCustomersFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;
  const sortKey: AdminCustomerSortKey =
    filters.sortKey && (filters.sortKey === "name" || filters.sortKey in ADMIN_CUSTOMER_SORT)
      ? (filters.sortKey as AdminCustomerSortKey)
      : "createdAt";
  const sortDir = filters.sortDir ?? "desc";
  const orderBy: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[] =
    sortKey === "name"
      ? [{ firstName: sortDir }, { lastName: sortDir }]
      : { [ADMIN_CUSTOMER_SORT[sortKey]!]: sortDir };
  const q = filters.q?.trim();
  const dateFilter =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const where: Prisma.UserWhereInput = {
    role: UserRole.CUSTOMER,
    deletedAt: null,
    // Guest-checkout placeholder accounts are not real customers — they're
    // excluded from the roster until (and unless) a checkout OTP promotes
    // one into a full account.
    isGuest: false,
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(filters.stateId === "NONE"
      ? { stateId: null }
      : filters.stateId
        ? { stateId: filters.stateId }
        : {}),
    ...(filters.tab === "missingState"
      ? { stateId: null }
      : filters.tab === "noOrders"
        ? { sellerOrders: { none: {} } }
        : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q, mode: "insensitive" as const } },
            { indianState: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isActive: true,
        isPhoneVerified: true,
        isEmailVerified: true,
        createdAt: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
        accountDeletionRequests: {
          where: { status: { in: ["PENDING_REVIEW", "SCHEDULED", "BLOCKED"] } },
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { status: true },
        },
        stateId: true,
        indianState: { select: { id: true, name: true } },
        _count: { select: { sellerOrders: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type CustomerDirectorySummary = {
  total: number;
  /** Registered in the last 30 days. */
  newLast30Days: number;
  /** Placed at least one order in the last 30 days. */
  activeBuyers: number;
  /** Sum of SellerOrder.totalAmount across all non-cancelled customer orders, all time. */
  revenue: number;
  /** % of customers who have ever ordered that have ordered more than once. */
  repeatPurchaseRatePercent: number;
  missingStateCount: number;
  registeredNoOrdersCount: number;
};

const CUSTOMER_ACTIVITY_WINDOW_DAYS = 30;

/** Powers the Customers list's stat cards + actionable-group alert banners — counts across the WHOLE roster, not the current filter/tab, same convention as getDealerApplicationsSummary. */
export async function getCustomerDirectorySummary(): Promise<CustomerDirectorySummary> {
  const cutoff = new Date(Date.now() - CUSTOMER_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const baseWhere = { role: UserRole.CUSTOMER, isGuest: false, deletedAt: null } as const;

  const [
    total,
    newLast30Days,
    missingStateCount,
    registeredNoOrdersCount,
    revenueAgg,
    buyerGroups,
    activeBuyerGroups,
  ] = await Promise.all([
    prisma.user.count({ where: baseWhere }),
    prisma.user.count({ where: { ...baseWhere, createdAt: { gte: cutoff } } }),
    prisma.user.count({ where: { ...baseWhere, stateId: null } }),
    prisma.user.count({ where: { ...baseWhere, sellerOrders: { none: {} } } }),
    prisma.sellerOrder.aggregate({
      _sum: { totalAmount: true },
      where: { status: { not: "CANCELLED" }, customerType: "CUSTOMER" },
    }),
    prisma.sellerOrder.groupBy({
      by: ["customerId"],
      where: { customerType: "CUSTOMER" },
      _count: { _all: true },
    }),
    prisma.sellerOrder.groupBy({
      by: ["customerId"],
      where: { customerType: "CUSTOMER", createdAt: { gte: cutoff } },
    }),
  ]);

  const repeatBuyers = buyerGroups.filter((g) => g._count._all >= 2).length;
  const totalBuyers = buyerGroups.length;

  return {
    total,
    newLast30Days,
    activeBuyers: activeBuyerGroups.length,
    revenue: Number(revenueAgg._sum.totalAmount ?? 0),
    repeatPurchaseRatePercent: totalBuyers > 0 ? (repeatBuyers / totalBuyers) * 100 : 0,
    missingStateCount,
    registeredNoOrdersCount,
  };
}

export type PosCustomerResult = {
  id: string;
  name: string;
  email: string | null;
  maskedPhone: string | null;
  city: string | null;
};

/**
 * POS's own async-search source for "Registered Customer" (spec §5) —
 * deliberately not `listCustomers` (the admin Customers-page roster),
 * which is a full paginated table, not a small ranked/limited typeahead
 * result set, and doesn't surface a city to disambiguate same-named
 * customers. Phone is masked here — this is a search-result list
 * rendered as someone types, not a confirmed-selection detail view.
 * Returns nothing for a query under 2 characters, same "don't scan the
 * whole table on every keystroke" intent as debouncing on the client.
 */
export async function searchCustomersForPos(q: string, limit = 10): Promise<PosCustomerResult[]> {
  const query = q.trim();
  if (query.length < 2) return [];

  const users = await prisma.user.findMany({
    where: {
      role: UserRole.CUSTOMER,
      isActive: true,
      isGuest: false,
      deletedAt: null,
      OR: [
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      addresses: { where: { isDefault: true }, take: 1, select: { cityTown: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: limit,
  });

  return users.map((u) => ({
    id: u.id,
    name: getFullName(u) ?? u.phone ?? "—",
    email: u.email,
    maskedPhone: u.phone ? maskIndianPhone(u.phone) : null,
    city: u.addresses[0]?.cityTown ?? null,
  }));
}

export type PosDealerResult = {
  /** DealerProfile id — what the POS actually needs to derive the dealer's verified state/catalogue, not the User id. */
  id: string;
  userId: string;
  name: string;
  storeName: string | null;
  maskedPhone: string | null;
  gstNumber: string | null;
  stateId: string | null;
  stateName: string | null;
  city: string | null;
};

/**
 * POS's search source for "Approved Dealer" (spec §7) — filters to
 * `status: APPROVED` (and the underlying account being active) in the
 * QUERY itself, not just in how the UI happens to render results, so a
 * pending/rejected/suspended dealer is never even a candidate row here.
 * This is the dropdown-population half of the "pending dealer must never
 * be selectable" requirement — placing a POS order still independently
 * re-verifies APPROVED status server-side (see the POS place-order
 * action), since a dealer could be suspended between searching and
 * placing the order.
 */
export async function searchApprovedDealersForPos(
  q: string,
  limit = 10,
): Promise<PosDealerResult[]> {
  const query = q.trim();
  if (query.length < 2) return [];

  const dealers = await prisma.dealerProfile.findMany({
    where: {
      status: ApplicationStatus.APPROVED,
      user: { isActive: true, deletedAt: null },
      OR: [
        { user: { firstName: { contains: query, mode: "insensitive" } } },
        { user: { lastName: { contains: query, mode: "insensitive" } } },
        { user: { phone: { contains: query, mode: "insensitive" } } },
        { storeName: { contains: query, mode: "insensitive" } },
        { gstNumber: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      userId: true,
      storeName: true,
      gstNumber: true,
      city: true,
      stateId: true,
      user: { select: { firstName: true, lastName: true, phone: true } },
      indianState: { select: { name: true } },
    },
    orderBy: { storeName: "asc" },
    take: limit,
  });

  return dealers.map((d) => ({
    id: d.id,
    userId: d.userId,
    name: getFullName(d.user) ?? d.user.phone ?? "—",
    storeName: d.storeName,
    maskedPhone: d.user.phone ? maskIndianPhone(d.user.phone) : null,
    gstNumber: d.gstNumber,
    stateId: d.stateId,
    stateName: d.indianState?.name ?? null,
    city: d.city,
  }));
}

type DecisionResult = { ok: true } | { ok: false; error: string };

function nextStatus(action: ApplicationDecisionInput["action"]): ApplicationStatus {
  switch (action) {
    case "APPROVE":
      return ApplicationStatus.APPROVED;
    case "REJECT":
      return ApplicationStatus.REJECTED;
    case "SUSPEND":
      return ApplicationStatus.SUSPENDED;
    case "REINSTATE":
      return ApplicationStatus.APPROVED;
  }
}

/**
 * Caller (a Server Action) must independently verify the actor is an
 * admin before calling this.
 *
 * Phase 2 fix: `sessionVersion` is only bumped for SUSPEND, not for
 * every transition. PENDING and REJECTED are application states, not
 * invalid-authentication states — a dealer who is mid-session on
 * /dealer/status must NOT be kicked to /login just because an admin
 * approved or rejected them; approving them should let their *next*
 * request naturally land on /account (and rejecting them should let it
 * land back on /dealer/status showing the reason), not force a fresh
 * login. Suspension is the one transition that's actually
 * security-sensitive (see access.ts module doc / validateUserSession)
 * and must invalidate any session issued before it. Reinstating a
 * suspended account doesn't need its own bump either: SUSPEND already
 * invalidated whatever session existed, so there's nothing left to
 * revoke.
 */
/**
 * Phase 3 addition: sends a mock approval notification (via the same
 * mock provider OTP already uses — see packages/providers/src/sms.ts, no
 * new notification channel invented) exactly once, only on a genuine
 * PENDING/REJECTED -> APPROVED transition. Reading `previousStatus`
 * BEFORE the update, and only sending when it *wasn't already* APPROVED,
 * is what prevents a duplicate send if this action is somehow invoked
 * twice for a dealer who's already approved (e.g. a stale page re-POSTed).
 */
export async function setDealerApplicationStatus(
  rawInput: ApplicationDecisionInput,
): Promise<DecisionResult> {
  const parsed = applicationDecisionSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { profileId, action, reason } = parsed.data;

  const status = nextStatus(action);
  const before = await prisma.dealerProfile.findUnique({
    where: { id: profileId },
    select: { status: true },
  });
  if (!before) return { ok: false, error: "Dealer application not found." };
  const isNewApproval = action === "APPROVE" && before.status !== ApplicationStatus.APPROVED;

  await prisma.$transaction(async (tx) => {
    const profile = await tx.dealerProfile.update({
      where: { id: profileId },
      data: {
        status,
        rejectionReason: action === "REJECT" ? (reason ?? "Not specified") : null,
        // Approval implies KYC review is complete too; keep the two fields
        // in sync at their terminal states.
        ...(action === "APPROVE" ? { kycStatus: KycStatus.APPROVED } : {}),
        ...(action === "REJECT" ? { kycStatus: KycStatus.REJECTED } : {}),
      },
      select: { userId: true },
    });
    if (action === "SUSPEND") {
      await tx.user.update({
        where: { id: profile.userId },
        data: { sessionVersion: { increment: 1 } },
      });
    }
    // "Customer becomes a dealer": the applicant has been shopping as a
    // CUSTOMER with a DealerProfile(PENDING) hanging off their account
    // (see packages/auth/src/dealer-application.ts). Approving them is the
    // moment their role actually flips — and their currently-live customer
    // session carries role:CUSTOMER in its JWT / cookie, so it must be
    // revoked (sessionVersion bump, same mechanism as SUSPEND) to force
    // both web and mobile to re-issue a DEALER session on the next request.
    // A brand-new dealer created by registerDealer() is already role:DEALER
    // with no prior session, so this is a no-op guard for them.
    if (isNewApproval) {
      const applicant = await tx.user.findUnique({
        where: { id: profile.userId },
        select: { role: true },
      });
      if (applicant && applicant.role !== UserRole.DEALER) {
        await tx.user.update({
          where: { id: profile.userId },
          data: { role: UserRole.DEALER, sessionVersion: { increment: 1 } },
        });
        // Their cart was filled from the CUSTOMER catalogue at customer
        // pricing/audience — none of it is valid for a dealer, so clear it
        // on the role flip (web + mobile both read this same cart).
        await tx.cartItem.deleteMany({ where: { userId: profile.userId } });
      }
    }
  });

  if (isNewApproval) {
    const user = await prisma.dealerProfile.findUnique({
      where: { id: profileId },
      select: { user: { select: { phone: true } } },
    });
    if (user?.user.phone) {
      // Best-effort notification — never block an approval on the SMS.
      // With the real gateway this needs its own DLT template
      // (SMSHUB_DEALER_APPROVED_TEMPLATE_ID / _TEMPLATE); until those are
      // registered the send just fails and is logged.
      const template = process.env.SMSHUB_DEALER_APPROVED_TEMPLATE?.trim();
      const message = template ?? "Your Kisan4U dealer account is approved. You can now log in.";
      const smsResult = await getSmsProvider().send(user.user.phone, message, {
        dltTemplateId: process.env.SMSHUB_DEALER_APPROVED_TEMPLATE_ID,
      });
      if (!smsResult.ok) {
        console.error(
          `[dealer-approval] SMS send failed for ${user.user.phone}: ${smsResult.error}`,
        );
      }
    }
  }

  return { ok: true };
}

/** Admin-only — validates the state exists and is active before writing it. Caller's Server Action must independently verify the actor is an admin. */
export async function setDealerState(profileId: string, stateId: string): Promise<DecisionResult> {
  const state = await prisma.indianState.findFirst({ where: { id: stateId, isActive: true } });
  if (!state) return { ok: false, error: "Select a valid state." };
  await prisma.dealerProfile.update({
    where: { id: profileId },
    data: { stateId: state.id, state: state.name },
  });
  return { ok: true };
}

/**
 * Admin-only — sets a seller's two independent commission rates
 * (`commissionPercent` for CUSTOMER orders, `dealerCommissionPercent` for
 * DEALER orders on the same seller). Caller's Server Action must
 * independently verify the actor is an admin.
 */
export async function setSellerCommission(
  rawInput: SellerCommissionInput,
): Promise<DecisionResult> {
  const parsed = sellerCommissionInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { profileId, commissionPercent, dealerCommissionPercent } = parsed.data;

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: profileId },
    select: { id: true },
  });
  if (!seller) return { ok: false, error: "Seller not found." };

  await prisma.sellerProfile.update({
    where: { id: profileId },
    data: { commissionPercent, dealerCommissionPercent },
  });
  return { ok: true };
}

/** Same session-revocation behavior as setDealerApplicationStatus above. */
export async function setSellerApplicationStatus(
  rawInput: ApplicationDecisionInput,
): Promise<DecisionResult> {
  const parsed = applicationDecisionSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { profileId, action, reason } = parsed.data;

  await prisma.$transaction(async (tx) => {
    const profile = await tx.sellerProfile.update({
      where: { id: profileId },
      data: {
        status: nextStatus(action),
        rejectionReason: action === "REJECT" ? (reason ?? "Not specified") : null,
      },
    });
    if (action === "SUSPEND") {
      await tx.user.update({
        where: { id: profile.userId },
        data: { sessionVersion: { increment: 1 } },
      });
    }
  });
  return { ok: true };
}

export type SellerApprovalResult =
  { ok: true; temporaryPassword?: string } | { ok: false; error: string };

/**
 * Approve a seller application (SUSPEND/REJECT/REINSTATE still go through
 * setSellerApplicationStatus). On a genuine PENDING/REJECTED -> APPROVED
 * transition for a seller who has NO login password yet (every seller
 * registered through the current apply form — registerSeller sets no
 * passwordHash), this also issues a one-time temporary password via
 * adminResetPassword and returns the plaintext to the admin exactly once,
 * to relay to the seller out of band. The seller is forced to change it
 * on first dashboard login (`mustChangePassword`).
 *
 * Idempotent: re-approving an already-APPROVED seller, or approving one
 * who already has a password (a legacy self-chosen one, or a re-approval
 * after suspension), just returns `{ ok: true }` with no password.
 */
export async function approveSellerApplication(
  profileId: string,
  actor: { id: string; role: UserRole },
): Promise<SellerApprovalResult> {
  const profile = await prisma.sellerProfile.findUnique({
    where: { id: profileId },
    select: { status: true, userId: true, user: { select: { passwordHash: true } } },
  });
  if (!profile) return { ok: false, error: "Seller application not found." };

  const wasApproved = profile.status === ApplicationStatus.APPROVED;
  if (!wasApproved) {
    await prisma.sellerProfile.update({
      where: { id: profileId },
      data: { status: ApplicationStatus.APPROVED, rejectionReason: null },
    });
  }

  if (!wasApproved && !profile.user.passwordHash) {
    const reset = await adminResetPassword(profile.userId, actor);
    if (!reset.ok) {
      // Status is already APPROVED; surface the failure so the admin can
      // retry issuing the password from the "Reset password" button.
      return { ok: false, error: `Approved, but issuing a password failed: ${reset.error}` };
    }
    return { ok: true, temporaryPassword: reset.temporaryPassword };
  }

  return { ok: true };
}

/**
 * Caller (a Server Action) must independently verify the actor is an
 * admin before calling this. Bumps `sessionVersion` on both activation
 * and deactivation (not just deactivation) — reactivating after a prior
 * deactivation should still force a clean re-login rather than letting
 * any session token issued before the deactivation silently work again.
 */
export async function setUserActive(rawInput: UserActiveToggleInput): Promise<DecisionResult> {
  const parsed = userActiveToggleSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { isActive: parsed.data.isActive, sessionVersion: { increment: 1 } },
  });
  return { ok: true };
}

/**
 * Wires up `AdminProfile.modulePermissions` (schema comment: e.g.
 * `{ "orders": true, "products": true, "reports": false }`) for real —
 * this field existed since Phase 0 but nothing read or wrote it before
 * now. One boolean per module key, matching that existing shape exactly
 * (this system does not support separate view/create sub-permissions per
 * module, so a module like "pos" gates the whole module at once).
 *
 * Fails OPEN, not closed: a missing AdminProfile row (most existing admins
 * — only the seed script creates one today) or a missing key in
 * `modulePermissions` both mean "not yet explicitly restricted," so
 * access is allowed. Only an explicit `false` for that key denies access.
 * This is deliberate — introducing this check must never silently lock
 * out an admin who was already using the module before this existed;
 * restriction is opt-in per admin, set explicitly by another admin.
 */
export async function hasModulePermission(userId: string, moduleKey: string): Promise<boolean> {
  const profile = await prisma.adminProfile.findUnique({
    where: { userId },
    select: { modulePermissions: true },
  });
  if (!profile) return true;
  const permissions = profile.modulePermissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return true;
  const value = (permissions as Record<string, unknown>)[moduleKey];
  return value !== false;
}

export async function setModulePermission(
  userId: string,
  moduleKey: string,
  allowed: boolean,
): Promise<{ ok: true }> {
  const existing = await prisma.adminProfile.findUnique({
    where: { userId },
    select: { modulePermissions: true },
  });
  const permissions =
    existing?.modulePermissions &&
    typeof existing.modulePermissions === "object" &&
    !Array.isArray(existing.modulePermissions)
      ? (existing.modulePermissions as Record<string, unknown>)
      : {};
  const nextPermissions = { ...permissions, [moduleKey]: allowed } as Prisma.InputJsonValue;

  await prisma.adminProfile.upsert({
    where: { userId },
    update: { modulePermissions: nextPermissions },
    create: { userId, roleName: "Admin", modulePermissions: nextPermissions },
  });
  return { ok: true };
}
