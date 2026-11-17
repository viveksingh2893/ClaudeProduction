/**
 * BA earnings ledger — accrual, lazy eligibility promotion, reversal, and
 * the BA-facing wallet summary.
 *
 * Lifecycle of a BaEarning: LOCKED -> ELIGIBLE -> SETTLED, or -> REVERSED.
 *
 *   REGISTRATION / DEALER_SIGNUP / DEALER_APPROVAL (flat amounts)
 *     Accrued LOCKED the moment the trigger happens. Unlock to ELIGIBLE
 *     only once the referred user has at least one seller order that is
 *     DELIVERED and past the return window (spec: "a BA is only eligible if
 *     the person he joined placed an order"; #2: "money after 48hrs of
 *     order delivery").
 *
 *   ORDER_COMMISSION (per seller order)
 *     Accrued LOCKED from settlement.ts when the seller order is DELIVERED,
 *     carrying its own eligibleAt = deliveredAt + returnWindowHours. Unlock
 *     when now >= eligibleAt. Reversed if the order is returned before it
 *     is SETTLED.
 *
 * No cron exists in this codebase — promoteEligibleBaEarnings() is called
 * lazily at the top of every BA wallet / earnings / settlement read, the
 * same pattern as promoteEligibleSettlements() for sellers.
 */

import { prisma, type BaEarningKind, type Prisma } from "@kisan4u/db";
import { round2 } from "../money";
import { getBaSettings } from "./settings";
import { payoutMonthKey } from "./settlement-cycle-ba";

type TxClient = Prisma.TransactionClient | typeof prisma;
/** Minimal surface the settlement transaction shares with this module. */
type BaEarningTx = Pick<typeof prisma, "baEarning">;

// ---------------------------------------------------------------------------
// Accrual
// ---------------------------------------------------------------------------

export async function accrueRegistrationEarning(params: {
  baId: string;
  referredUserId: string;
}): Promise<void> {
  const existing = await prisma.baEarning.findFirst({
    where: { baId: params.baId, sourceUserId: params.referredUserId, kind: "REGISTRATION" },
    select: { id: true },
  });
  if (existing) return;

  const settings = await getBaSettings();
  await prisma.baEarning.create({
    data: {
      baId: params.baId,
      kind: "REGISTRATION",
      status: "LOCKED",
      amount: round2(settings.registrationAmount),
      flatAmountSnapshot: round2(settings.registrationAmount),
      sourceUserId: params.referredUserId,
    },
  });
}

/**
 * ₹50 (configurable) when a referred user creates a DEALER account
 * directly (spec #13). Resolves the BA from the user's referredByBaId.
 */
export async function accrueDealerSignupEarning(params: { referredUserId: string }): Promise<void> {
  await accrueDealerFlatEarning(params.referredUserId, "DEALER_SIGNUP", (s) => s.dealerSignupAmount);
}

/**
 * ₹50 (configurable) when a referred user's dealer application is APPROVED
 * (spec #5: credit only on final approval, never provisionally; #13).
 */
export async function accrueDealerApprovalEarning(params: { referredUserId: string }): Promise<void> {
  await accrueDealerFlatEarning(
    params.referredUserId,
    "DEALER_APPROVAL",
    (s) => s.dealerApprovalAmount,
  );
}

async function accrueDealerFlatEarning(
  referredUserId: string,
  kind: Extract<BaEarningKind, "DEALER_SIGNUP" | "DEALER_APPROVAL">,
  pick: (s: Awaited<ReturnType<typeof getBaSettings>>) => number,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: referredUserId },
    select: { referredByBaId: true },
  });
  if (!user?.referredByBaId) return;

  const ba = await prisma.businessAssociateProfile.findUnique({
    where: { id: user.referredByBaId },
    select: { id: true, status: true },
  });
  // A suspended BA earns nothing further (spec #32).
  if (!ba || ba.status === "SUSPENDED" || ba.status === "REJECTED" || ba.status === "PENDING") {
    return;
  }

  const existing = await prisma.baEarning.findFirst({
    where: { baId: ba.id, sourceUserId: referredUserId, kind },
    select: { id: true },
  });
  if (existing) return;

  const settings = await getBaSettings();
  const amount = round2(pick(settings));
  await prisma.baEarning.create({
    data: {
      baId: ba.id,
      kind,
      status: "LOCKED",
      amount,
      flatAmountSnapshot: amount,
      sourceUserId: referredUserId,
    },
  });
}

// ---------------------------------------------------------------------------
// Order-commission accrual (called from settlement.ts, inside its tx)
// ---------------------------------------------------------------------------

export async function accrueOrderCommissionEarning(
  tx: BaEarningTx,
  params: {
    baId: string;
    referredUserId: string;
    sellerOrderId: string;
    checkoutGroupId: string;
    sellerId: string;
    amount: number;
    ratePercent: number;
    commissionBase: number;
    deliveredAt: Date | null;
    eligibleAt: Date;
  },
): Promise<void> {
  const existing = await tx.baEarning.findFirst({
    where: { sourceSellerOrderId: params.sellerOrderId, kind: "ORDER_COMMISSION" },
    select: { id: true, status: true },
  });

  // Once settled or reversed, never touch it again.
  if (existing && (existing.status === "SETTLED" || existing.status === "REVERSED")) return;

  const eligibleNow = params.eligibleAt.getTime() <= Date.now();
  const data = {
    baId: params.baId,
    kind: "ORDER_COMMISSION" as const,
    status: (eligibleNow ? "ELIGIBLE" : "LOCKED") as "ELIGIBLE" | "LOCKED",
    amount: round2(params.amount),
    ratePercentSnapshot: params.ratePercent,
    commissionBaseSnapshot: round2(params.commissionBase),
    sourceUserId: params.referredUserId,
    sourceSellerOrderId: params.sellerOrderId,
    sourceCheckoutGroupId: params.checkoutGroupId,
    sellerId: params.sellerId,
    deliveredAt: params.deliveredAt,
    eligibleAt: params.eligibleAt,
    payoutMonth: eligibleNow ? payoutMonthKey(new Date()) : null,
  };

  if (existing) {
    await tx.baEarning.update({ where: { id: existing.id }, data });
  } else {
    await tx.baEarning.create({ data });
  }
}

// ---------------------------------------------------------------------------
// Reversal
// ---------------------------------------------------------------------------

/** Reverse the ORDER_COMMISSION earning for a returned/cancelled seller order (unless already SETTLED). */
export async function reverseOrderCommissionEarning(
  tx: BaEarningTx,
  sellerOrderId: string,
  reason: string,
): Promise<void> {
  await tx.baEarning.updateMany({
    where: {
      sourceSellerOrderId: sellerOrderId,
      kind: "ORDER_COMMISSION",
      status: { in: ["LOCKED", "ELIGIBLE"] },
    },
    data: { status: "REVERSED", reversedReason: reason },
  });
}

// ---------------------------------------------------------------------------
// Lazy eligibility promotion
// ---------------------------------------------------------------------------

/**
 * LOCKED -> ELIGIBLE. Safe to call repeatedly. Returns the number promoted.
 *
 *  - ORDER_COMMISSION: eligibleAt has passed.
 *  - flat kinds: the referred user has >= 1 seller order DELIVERED and past
 *    the return window.
 */
export async function promoteEligibleBaEarnings(baId?: string): Promise<number> {
  const now = Date.now();
  const settings = await getBaSettings();
  const windowMs = settings.returnWindowHours * 60 * 60 * 1000;

  const locked = await prisma.baEarning.findMany({
    where: { status: "LOCKED", ...(baId ? { baId } : {}) },
    select: { id: true, kind: true, sourceUserId: true, eligibleAt: true },
  });
  if (locked.length === 0) return 0;

  // Which referred users have a settled-enough delivered order? Resolve once.
  const flatUserIds = [
    ...new Set(locked.filter((e) => e.kind !== "ORDER_COMMISSION").map((e) => e.sourceUserId)),
  ];
  const qualifiedUsers = new Set<string>();
  if (flatUserIds.length > 0) {
    const deliveredCutoff = new Date(now - windowMs);
    const rows = await prisma.sellerOrder.findMany({
      where: {
        customerId: { in: flatUserIds },
        status: "DELIVERED",
        statusHistory: {
          some: { status: "DELIVERED", createdAt: { lte: deliveredCutoff } },
        },
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    for (const r of rows) qualifiedUsers.add(r.customerId);
  }

  const toPromote: string[] = [];
  for (const e of locked) {
    if (e.kind === "ORDER_COMMISSION") {
      if (e.eligibleAt && e.eligibleAt.getTime() <= now) toPromote.push(e.id);
    } else if (qualifiedUsers.has(e.sourceUserId)) {
      toPromote.push(e.id);
    }
  }
  if (toPromote.length === 0) return 0;

  const month = payoutMonthKey(new Date());
  const res = await prisma.baEarning.updateMany({
    where: { id: { in: toPromote }, status: "LOCKED" },
    data: { status: "ELIGIBLE", payoutMonth: month },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// BA-facing wallet summary — the 4 buckets (spec answer #1)
// ---------------------------------------------------------------------------

export type BaWalletBucketBreakdown = {
  registration: number;
  dealerSignup: number;
  dealerApproval: number;
  orderCommission: number;
};

export type BaWalletSummary = {
  /** Everything ever earned that has not been reversed (LOCKED + ELIGIBLE + SETTLED). */
  totalEarned: number;
  /** Earned but the referred user has not triggered eligibility yet. */
  lockedPending: number;
  /** Redeemable now — will be included in the next monthly payout. */
  eligible: number;
  /** Already paid out in a BaSettlement batch. */
  settled: number;
  /** Clawed back (dealer rejection, order return/cancel). */
  reversed: number;
  byKind: {
    total: BaWalletBucketBreakdown;
    eligible: BaWalletBucketBreakdown;
  };
  recent: {
    id: string;
    kind: BaEarningKind;
    status: string;
    amount: number;
    createdAt: Date;
    eligibleAt: Date | null;
  }[];
};

const ZERO_BREAKDOWN: BaWalletBucketBreakdown = {
  registration: 0,
  dealerSignup: 0,
  dealerApproval: 0,
  orderCommission: 0,
};

function bucketKey(kind: BaEarningKind): keyof BaWalletBucketBreakdown {
  switch (kind) {
    case "REGISTRATION":
      return "registration";
    case "DEALER_SIGNUP":
      return "dealerSignup";
    case "DEALER_APPROVAL":
      return "dealerApproval";
    case "ORDER_COMMISSION":
      return "orderCommission";
  }
}

export async function getBaWalletSummary(baId: string): Promise<BaWalletSummary> {
  await promoteEligibleBaEarnings(baId);

  const earnings = await prisma.baEarning.findMany({
    where: { baId },
    orderBy: { createdAt: "desc" },
  });

  let totalEarned = 0;
  let lockedPending = 0;
  let eligible = 0;
  let settled = 0;
  let reversed = 0;
  const total = { ...ZERO_BREAKDOWN };
  const eligibleBreakdown = { ...ZERO_BREAKDOWN };

  for (const e of earnings) {
    const amt = Number(e.amount);
    const key = bucketKey(e.kind);
    if (e.status === "REVERSED") {
      reversed += amt;
      continue;
    }
    totalEarned += amt;
    total[key] += amt;
    if (e.status === "LOCKED") lockedPending += amt;
    else if (e.status === "ELIGIBLE") {
      eligible += amt;
      eligibleBreakdown[key] += amt;
    } else if (e.status === "SETTLED") settled += amt;
  }

  const r2 = (n: number) => round2(n);
  return {
    totalEarned: r2(totalEarned),
    lockedPending: r2(lockedPending),
    eligible: r2(eligible),
    settled: r2(settled),
    reversed: r2(reversed),
    byKind: {
      total: Object.fromEntries(
        Object.entries(total).map(([k, v]) => [k, r2(v)]),
      ) as BaWalletBucketBreakdown,
      eligible: Object.fromEntries(
        Object.entries(eligibleBreakdown).map(([k, v]) => [k, r2(v)]),
      ) as BaWalletBucketBreakdown,
    },
    recent: earnings.slice(0, 30).map((e) => ({
      id: e.id,
      kind: e.kind,
      status: e.status,
      amount: Number(e.amount),
      createdAt: e.createdAt,
      eligibleAt: e.eligibleAt,
    })),
  };
}

export type BaEarningListFilters = {
  kind?: BaEarningKind;
  status?: "LOCKED" | "ELIGIBLE" | "SETTLED" | "REVERSED";
  take?: number;
  skip?: number;
};

export async function listBaEarnings(baId: string, filters: BaEarningListFilters = {}) {
  await promoteEligibleBaEarnings(baId);
  return prisma.baEarning.findMany({
    where: {
      baId,
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.take ?? 50, 200),
    skip: filters.skip ?? 0,
  });
}

export type BaEarningsRowSummary = {
  totalCommission: number;
  redeemableCommission: number;
  referredOrders: number;
  referredSales: number;
};

/**
 * Batch per-BA ledger totals for the admin BA list — deliberately does
 * NOT call promoteEligibleBaEarnings per row (that's a per-BA write,
 * and would mean 20+ writes on every list page load); rows are
 * promoted lazily whenever that BA's own wallet/detail page is read
 * instead, same "lazy, read-triggered" convention as the rest of this
 * module, just not re-triggered from this read-only list aggregate.
 */
export async function getBaEarningsSummaryByIds(
  baIds: string[],
): Promise<Map<string, BaEarningsRowSummary>> {
  if (baIds.length === 0) return new Map();
  const rows = await prisma.baEarning.groupBy({
    by: ["baId", "status", "kind"],
    where: { baId: { in: baIds } },
    _sum: { amount: true, commissionBaseSnapshot: true },
    _count: { _all: true },
  });

  const map = new Map<string, BaEarningsRowSummary>();
  for (const baId of baIds) {
    map.set(baId, { totalCommission: 0, redeemableCommission: 0, referredOrders: 0, referredSales: 0 });
  }
  for (const row of rows) {
    const entry = map.get(row.baId);
    if (!entry) continue;
    const amount = Number(row._sum.amount ?? 0);
    if (row.status !== "REVERSED") entry.totalCommission += amount;
    if (row.status === "ELIGIBLE") entry.redeemableCommission += amount;
    if (row.kind === "ORDER_COMMISSION" && row.status !== "REVERSED") {
      entry.referredOrders += row._count._all;
      entry.referredSales += Number(row._sum.commissionBaseSnapshot ?? 0);
    }
  }
  for (const entry of map.values()) {
    entry.totalCommission = round2(entry.totalCommission);
    entry.redeemableCommission = round2(entry.redeemableCommission);
    entry.referredSales = round2(entry.referredSales);
  }
  return map;
}
