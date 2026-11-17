/**
 * BA monthly payout batches (BaSettlement).
 *
 * Flow (spec: manual bank transfer, admin ticks "funds transferred"):
 *   1. Earnings become ELIGIBLE lazily (earnings.ts:promoteEligibleBaEarnings).
 *   2. Admin opens the BA settlement page for a month cycle -> sees every BA
 *      with an eligible balance, and whether they have submitted bank
 *      details (BANK_SUBMITTED).
 *   3. Admin builds a batch per BA (buildBaSettlementBatch): a PENDING
 *      BaSettlement row is created, the ELIGIBLE earnings are linked to it,
 *      and the BA's bank details are snapshotted onto it.
 *   4. Admin transfers the money by hand, then marks the batch PAID
 *      (markBaSettlementPaid): the linked earnings flip to SETTLED.
 *
 * No automated payout integration exists — same as seller settlement.
 */

import { prisma } from "@kisan4u/db";
import { round2 } from "../money";
import { promoteEligibleBaEarnings } from "./earnings";
import { payoutMonthKey, baPayoutCycleFromKey, recentBaPayoutCycles } from "./settlement-cycle-ba";

/** BAs eligible to actually receive money have had their bank/KYC details admin-approved — not merely submitted (see BaBankStatus's schema doc comment). */
function hasBankDetails(bankStatus: string): boolean {
  return bankStatus === "APPROVED";
}

export type BaSettlementOverviewRow = {
  baId: string;
  referralCode: string;
  name: string;
  status: string;
  hasBankDetails: boolean;
  /** ELIGIBLE, not yet in any batch. */
  eligibleUnbatched: number;
  /** In a PENDING batch for this month. */
  batchedPending: number;
  /** Already PAID for this month. */
  paid: number;
  settlementId: string | null;
  settlementStatus: string | null;
};

export type BaSettlementOverview = {
  monthKey: string;
  monthLabel: string;
  cycles: { key: string; label: string }[];
  rows: BaSettlementOverviewRow[];
  totals: { eligibleUnbatched: number; batchedPending: number; paid: number };
};

export async function getBaSettlementOverview(monthKey?: string): Promise<BaSettlementOverview> {
  await promoteEligibleBaEarnings();

  const cycle = (monthKey && baPayoutCycleFromKey(monthKey)) || baPayoutCycleFromKey(payoutMonthKey(new Date()))!;
  const cycles = recentBaPayoutCycles(new Date(), 12).map((c) => ({ key: c.key, label: c.label }));

  // Every BA that has any earning at all, plus this month's batches.
  const [bas, monthEarnings, monthSettlements] = await Promise.all([
    prisma.businessAssociateProfile.findMany({
      select: { id: true, referralCode: true, firstName: true, lastName: true, status: true, bankStatus: true },
    }),
    prisma.baEarning.findMany({
      where: {
        status: { in: ["ELIGIBLE", "SETTLED"] },
        payoutMonth: { lte: cycle.key },
      },
      select: { id: true, baId: true, amount: true, status: true, settlementId: true },
    }),
    prisma.baSettlement.findMany({
      where: { month: cycle.key },
      select: { id: true, baId: true, status: true },
    }),
  ]);

  const settlementByBa = new Map(monthSettlements.map((s) => [s.baId, s]));
  const rows: BaSettlementOverviewRow[] = [];
  const totals = { eligibleUnbatched: 0, batchedPending: 0, paid: 0 };

  for (const ba of bas) {
    const mine = monthEarnings.filter((e) => e.baId === ba.id);
    if (mine.length === 0 && !settlementByBa.has(ba.id)) continue;

    let eligibleUnbatched = 0;
    let batchedPending = 0;
    let paid = 0;
    for (const e of mine) {
      const amt = Number(e.amount);
      if (e.status === "SETTLED") paid += amt;
      else if (e.settlementId) batchedPending += amt;
      else eligibleUnbatched += amt;
    }

    const st = settlementByBa.get(ba.id) ?? null;
    rows.push({
      baId: ba.id,
      referralCode: ba.referralCode,
      name: `${ba.firstName} ${ba.lastName}`.trim(),
      status: ba.status,
      hasBankDetails: hasBankDetails(ba.bankStatus),
      eligibleUnbatched: round2(eligibleUnbatched),
      batchedPending: round2(batchedPending),
      paid: round2(paid),
      settlementId: st?.id ?? null,
      settlementStatus: st?.status ?? null,
    });
    totals.eligibleUnbatched += eligibleUnbatched;
    totals.batchedPending += batchedPending;
    totals.paid += paid;
  }

  rows.sort((a, b) => b.eligibleUnbatched - a.eligibleUnbatched || a.name.localeCompare(b.name));
  return {
    monthKey: cycle.key,
    monthLabel: cycle.label,
    cycles,
    rows,
    totals: {
      eligibleUnbatched: round2(totals.eligibleUnbatched),
      batchedPending: round2(totals.batchedPending),
      paid: round2(totals.paid),
    },
  };
}

export type BuildBatchResult =
  | { ok: true; settlementId: string; total: number; count: number }
  | { ok: false; error: string };

/**
 * Gather every ELIGIBLE, unbatched earning for one BA with payoutMonth <=
 * the given cycle, into a single PENDING BaSettlement. Idempotent per
 * (baId, month): re-running adds any newly-eligible earnings to the same
 * PENDING row and refreshes its total; refuses once the row is PAID.
 */
export async function buildBaSettlementBatch(baId: string, monthKey: string): Promise<BuildBatchResult> {
  await promoteEligibleBaEarnings(baId);
  const cycle = baPayoutCycleFromKey(monthKey);
  if (!cycle) return { ok: false, error: "Invalid payout month." };

  const ba = await prisma.businessAssociateProfile.findUnique({ where: { id: baId } });
  if (!ba) return { ok: false, error: "BA not found." };
  if (!hasBankDetails(ba.bankStatus)) {
    return { ok: false, error: "This BA's bank details have not been approved yet." };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.baSettlement.findUnique({
      where: { baId_month: { baId, month: monthKey } },
    });
    if (existing?.status === "PAID") {
      return { ok: false as const, error: "This month's payout is already marked paid." };
    }

    const eligible = await tx.baEarning.findMany({
      where: { baId, status: "ELIGIBLE", settlementId: null, payoutMonth: { lte: monthKey } },
      select: { id: true, amount: true },
    });
    if (eligible.length === 0 && !existing) {
      return { ok: false as const, error: "Nothing eligible to pay out for this BA yet." };
    }

    const bankSnapshot = {
      bankName: ba.bankName,
      bankBranch: ba.bankBranch,
      accountHolderName: ba.accountHolderName,
      accountNumber: ba.accountNumber,
      ifsc: ba.ifsc,
      panNumber: ba.panNumber,
    };

    const settlement =
      existing ??
      (await tx.baSettlement.create({
        data: { baId, month: monthKey, totalAmount: 0, bankSnapshot, status: "PENDING" },
      }));

    if (eligible.length > 0) {
      await tx.baEarning.updateMany({
        where: { id: { in: eligible.map((e) => e.id) } },
        data: { settlementId: settlement.id },
      });
    }

    const linked = await tx.baEarning.findMany({
      where: { settlementId: settlement.id },
      select: { amount: true },
    });
    const total = round2(linked.reduce((s, e) => s + Number(e.amount), 0));
    await tx.baSettlement.update({
      where: { id: settlement.id },
      data: { totalAmount: total, bankSnapshot },
    });

    return { ok: true as const, settlementId: settlement.id, total, count: linked.length };
  });
}

export type MarkPaidResult = { ok: true } | { ok: false; error: string };

export async function markBaSettlementPaid(
  settlementId: string,
  adminUserId: string,
  note?: string,
): Promise<MarkPaidResult> {
  return prisma.$transaction(async (tx) => {
    const s = await tx.baSettlement.findUnique({ where: { id: settlementId } });
    if (!s) return { ok: false as const, error: "Payout batch not found." };
    if (s.status === "PAID") return { ok: false as const, error: "Already marked paid." };

    await tx.baEarning.updateMany({
      where: { settlementId, status: "ELIGIBLE" },
      data: { status: "SETTLED" },
    });
    await tx.baSettlement.update({
      where: { id: settlementId },
      data: {
        status: "PAID",
        transferredById: adminUserId,
        transferredAt: new Date(),
        note: note ?? null,
      },
    });
    return { ok: true as const };
  });
}

/** Undo a PENDING (not yet paid) batch — unlink its earnings, delete the row. */
export async function discardBaSettlementBatch(settlementId: string): Promise<MarkPaidResult> {
  return prisma.$transaction(async (tx) => {
    const s = await tx.baSettlement.findUnique({ where: { id: settlementId } });
    if (!s) return { ok: false as const, error: "Payout batch not found." };
    if (s.status === "PAID") return { ok: false as const, error: "Cannot discard a paid batch." };
    await tx.baEarning.updateMany({ where: { settlementId }, data: { settlementId: null } });
    await tx.baSettlement.delete({ where: { id: settlementId } });
    return { ok: true as const };
  });
}

export async function listBaSettlements(baId?: string) {
  return prisma.baSettlement.findMany({
    where: baId ? { baId } : undefined,
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    include: {
      ba: { select: { referralCode: true, firstName: true, lastName: true } },
      _count: { select: { earnings: true } },
    },
  });
}

export async function getBaSettlement(id: string) {
  return prisma.baSettlement.findUnique({
    where: { id },
    include: {
      ba: { select: { id: true, referralCode: true, firstName: true, lastName: true } },
      earnings: { orderBy: { createdAt: "desc" } },
    },
  });
}
