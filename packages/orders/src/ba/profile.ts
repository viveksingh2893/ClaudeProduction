/**
 * BA profile lifecycle:
 *   (no row)  ->  PENDING (Form 1)  ->  APPROVED (admin)  ->  BANK_SUBMITTED (Form 2)
 *                        \-> REJECTED (admin)      any -> SUSPENDED (admin) -> APPROVED (reinstate)
 *
 * Front-end status labels map as:
 *   no row          -> "Not registered as BA"
 *   PENDING         -> "Pending for approval"
 *   APPROVED        -> "Approved BA without bank details"
 *   BANK_SUBMITTED  -> "Approved BA"
 *   REJECTED        -> "Application rejected"
 *   SUSPENDED       -> "Suspended"
 */

import { prisma, getFullName, type BaStatus, type BaBankStatus, type Prisma } from "@kisan4u/db";
import type { BaForm1Input, BaForm2Input, BaAdminEditInput } from "@kisan4u/validators";
import { writeAuditLog } from "../audit";
import { notifyUser } from "../notifications";
import { generateBaReferralCode } from "./referral";
import { accrueDealerApprovalEarning } from "./earnings";

export type BaProfileView = {
  id: string;
  userId: string;
  referralCode: string;
  status: BaStatus;
  frontendStatus:
    "NOT_REGISTERED" | "PENDING" | "APPROVED_NO_BANK" | "APPROVED" | "REJECTED" | "SUSPENDED";
  firstName: string;
  lastName: string;
  contactNumber: string;
  email: string;
  pincode: string;
  state: string;
  city: string;
  /** Bank/KYC details admin-approved — the actual payout-eligibility gate (see BaBankStatus's schema doc comment), not merely "submitted." */
  hasBankDetails: boolean;
  bankStatus: BaBankStatus;
  bankSubmittedAt: Date | null;
  bankReviewedAt: Date | null;
  bankRejectionReason: string | null;
  panNumber: string | null;
  bankName: string | null;
  bankBranch: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  panDocKey: string | null;
  chequeDocKey: string | null;
  rejectedReason: string | null;
  createdAt: Date;
};

function frontendStatus(status: BaStatus): BaProfileView["frontendStatus"] {
  switch (status) {
    case "PENDING":
      return "PENDING";
    case "APPROVED":
      return "APPROVED_NO_BANK";
    case "BANK_SUBMITTED":
      return "APPROVED";
    case "REJECTED":
      return "REJECTED";
    case "SUSPENDED":
      return "SUSPENDED";
  }
}

function toView(p: NonNullable<Awaited<ReturnType<typeof findRaw>>>): BaProfileView {
  return {
    id: p.id,
    userId: p.userId,
    referralCode: p.referralCode,
    status: p.status,
    frontendStatus: frontendStatus(p.status),
    firstName: p.firstName,
    lastName: p.lastName,
    contactNumber: p.contactNumber,
    email: p.email,
    pincode: p.pincode,
    state: p.state,
    city: p.city,
    hasBankDetails: p.bankStatus === "APPROVED",
    bankStatus: p.bankStatus,
    bankSubmittedAt: p.bankSubmittedAt,
    bankReviewedAt: p.bankReviewedAt,
    bankRejectionReason: p.bankRejectionReason,
    panNumber: p.panNumber,
    bankName: p.bankName,
    bankBranch: p.bankBranch,
    accountHolderName: p.accountHolderName,
    accountNumber: p.accountNumber,
    ifsc: p.ifsc,
    panDocKey: p.panDocKey,
    chequeDocKey: p.chequeDocKey,
    rejectedReason: p.rejectedReason,
    createdAt: p.createdAt,
  };
}

function findRaw(userId: string) {
  return prisma.businessAssociateProfile.findUnique({ where: { userId } });
}

/** The BA section's state for one user. Null => "Not registered as BA". */
export async function getBaProfileForUser(userId: string): Promise<BaProfileView | null> {
  const p = await findRaw(userId);
  return p ? toView(p) : null;
}

export async function getBaProfileById(baId: string): Promise<BaProfileView | null> {
  const p = await prisma.businessAssociateProfile.findUnique({ where: { id: baId } });
  return p ? toView(p) : null;
}

export type SubmitResult = { ok: true; baId: string } | { ok: false; error: string };

/**
 * Form 1 submit. Creates a PENDING profile, or re-opens a REJECTED one for
 * a fresh review. `contactNumber` must match the caller's verified phone.
 */
export async function submitBaForm1(userId: string, input: BaForm1Input): Promise<SubmitResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, isActive: true },
  });
  if (!user || !user.isActive) return { ok: false, error: "Account not found." };
  if (!user.phone || user.phone !== input.contactNumber) {
    return { ok: false, error: "Your contact number must match your verified account number." };
  }

  const existing = await findRaw(userId);
  if (existing && existing.status !== "REJECTED") {
    return { ok: false, error: "You already have a Business Associate application." };
  }

  const data = {
    firstName: input.firstName,
    lastName: input.lastName,
    contactNumber: input.contactNumber,
    email: input.email,
    pincode: input.pincode,
    state: input.state,
    city: input.city,
    status: "PENDING" as const,
    rejectedReason: null,
  };

  const row = existing
    ? await prisma.businessAssociateProfile.update({ where: { id: existing.id }, data })
    : await prisma.businessAssociateProfile.create({
        data: { ...data, userId, referralCode: await issueUniqueCode() },
      });

  return { ok: true, baId: row.id };
}

async function issueUniqueCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = generateBaReferralCode();
    const clash = await prisma.businessAssociateProfile.findUnique({
      where: { referralCode: code },
    });
    if (!clash) return code;
  }
  throw new Error("Could not allocate a unique BA referral code");
}

/**
 * Form 2 submit (KYC + bank). Only an APPROVED BA may submit; moves them to
 * BANK_SUBMITTED and unlocks redemption. Duplicate PAN / account number are
 * rejected (spec #6, #31).
 */
export async function submitBaForm2(userId: string, input: BaForm2Input): Promise<SubmitResult> {
  const p = await findRaw(userId);
  if (!p) return { ok: false, error: "Submit the basic details form first." };
  if (p.status !== "APPROVED" && p.status !== "BANK_SUBMITTED") {
    return {
      ok: false,
      error: "Your application must be approved before you can add bank details.",
    };
  }

  const [panClash, acctClash] = await Promise.all([
    prisma.businessAssociateProfile.findFirst({
      where: { panNumber: input.panNumber, id: { not: p.id } },
      select: { id: true },
    }),
    prisma.businessAssociateProfile.findFirst({
      where: { accountNumber: input.accountNumber, id: { not: p.id } },
      select: { id: true },
    }),
  ]);
  if (panClash)
    return { ok: false, error: "This PAN is already registered to another Business Associate." };
  if (acctClash)
    return {
      ok: false,
      error: "This bank account is already registered to another Business Associate.",
    };

  await prisma.businessAssociateProfile.update({
    where: { id: p.id },
    data: {
      panNumber: input.panNumber,
      panDocKey: input.panDocKey,
      bankName: input.bankName,
      bankBranch: input.bankBranch,
      accountHolderName: input.accountHolderName,
      accountNumber: input.accountNumber,
      ifsc: input.ifsc,
      chequeDocKey: input.chequeDocKey,
      bankSubmittedAt: new Date(),
      status: "BANK_SUBMITTED",
      // Every (re)submission — including after a REJECTED review — re-enters
      // the admin review queue and clears any previous decision, so a fixed
      // resubmission is never left showing the old rejection reason.
      bankStatus: "PENDING_APPROVAL",
      bankReviewedById: null,
      bankReviewedAt: null,
      bankRejectionReason: null,
    },
  });
  return { ok: true, baId: p.id };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type AdminActionResult = { ok: true } | { ok: false; error: string };

export async function adminDecideBa(
  adminUserId: string,
  baId: string,
  decision: "APPROVE" | "REJECT" | "SUSPEND" | "REINSTATE",
  reason?: string,
): Promise<AdminActionResult> {
  const p = await prisma.businessAssociateProfile.findUnique({ where: { id: baId } });
  if (!p) return { ok: false, error: "BA not found." };

  let next: BaStatus = p.status;
  if (decision === "APPROVE") {
    if (p.status !== "PENDING")
      return { ok: false, error: "Only a pending application can be approved." };
    next = "APPROVED";
  } else if (decision === "REJECT") {
    if (p.status !== "PENDING")
      return { ok: false, error: "Only a pending application can be rejected." };
    next = "REJECTED";
  } else if (decision === "SUSPEND") {
    if (p.status === "SUSPENDED" || p.status === "REJECTED") {
      return { ok: false, error: "Nothing to suspend." };
    }
    next = "SUSPENDED";
  } else if (decision === "REINSTATE") {
    if (p.status !== "SUSPENDED")
      return { ok: false, error: "Only a suspended BA can be reinstated." };
    // Reinstate to the pre-suspension tier: keep bank details if present.
    next = p.bankSubmittedAt ? "BANK_SUBMITTED" : "APPROVED";
  }

  await prisma.businessAssociateProfile.update({
    where: { id: baId },
    data: {
      status: next,
      approvedById: decision === "APPROVE" ? adminUserId : p.approvedById,
      approvedAt: decision === "APPROVE" ? new Date() : p.approvedAt,
      rejectedReason:
        decision === "REJECT" ? (reason ?? null) : decision === "APPROVE" ? null : p.rejectedReason,
      suspendedAt:
        decision === "SUSPEND" ? new Date() : decision === "REINSTATE" ? null : p.suspendedAt,
    },
  });

  await writeAuditLog({
    actorId: adminUserId,
    actorRole: "ADMIN",
    action: `BA_${decision}`,
    entityType: "BusinessAssociateProfile",
    entityId: baId,
    reason,
  });
  return { ok: true };
}

/**
 * Admin approve/reject of a BA's submitted bank/KYC details — independent
 * of adminDecideBa above (which only ever decides the Form-1/whole-profile
 * PENDING->APPROVED/REJECTED step). Only meaningful once details have
 * actually been submitted (bankStatus PENDING_APPROVAL, or re-reviewing an
 * already-decided one); approving unlocks payout (see settlement.ts's
 * hasBankDetails).
 */
export async function adminDecideBaBank(
  adminUserId: string,
  baId: string,
  decision: "APPROVE" | "REJECT",
  reason?: string,
): Promise<AdminActionResult> {
  const p = await prisma.businessAssociateProfile.findUnique({ where: { id: baId } });
  if (!p) return { ok: false, error: "BA not found." };
  if (p.bankStatus === "NOT_SUBMITTED") {
    return { ok: false, error: "This BA hasn't submitted bank details yet." };
  }
  if (decision === "REJECT" && !reason?.trim()) {
    return { ok: false, error: "A rejection reason is required." };
  }

  await prisma.businessAssociateProfile.update({
    where: { id: baId },
    data: {
      bankStatus: decision === "APPROVE" ? "APPROVED" : "REJECTED",
      bankReviewedById: adminUserId,
      bankReviewedAt: new Date(),
      bankRejectionReason: decision === "REJECT" ? reason!.trim() : null,
    },
  });

  await writeAuditLog({
    actorId: adminUserId,
    actorRole: "ADMIN",
    action: `BA_BANK_${decision}`,
    entityType: "BusinessAssociateProfile",
    entityId: baId,
    reason,
  });

  // Otherwise the BA only finds out by happening to revisit /account/ba —
  // there was previously no signal at all that a decision had been made.
  await notifyUser({
    userId: p.userId,
    title: decision === "APPROVE" ? "Bank details approved" : "Bank details rejected",
    body:
      decision === "APPROVE"
        ? "Your bank details were approved. You can now withdraw your Business Associate earnings."
        : `Your bank details were rejected: ${reason!.trim()}`,
    linkUrl: "/account/ba",
  }).catch(() => {});

  return { ok: true };
}

/** Admin editing every BA field (including bank details / doc uploads). Audit-logged. */
export async function adminEditBa(
  adminUserId: string,
  input: BaAdminEditInput,
): Promise<AdminActionResult> {
  const p = await prisma.businessAssociateProfile.findUnique({ where: { id: input.baId } });
  if (!p) return { ok: false, error: "BA not found." };

  const norm = (v: string | undefined | null) => {
    const t = (v ?? "").trim();
    return t.length ? t : null;
  };

  // Duplicate guards when bank identity fields are being set.
  const pan = norm(input.panNumber);
  const acct = norm(input.accountNumber);
  if (pan) {
    const clash = await prisma.businessAssociateProfile.findFirst({
      where: { panNumber: pan, id: { not: p.id } },
      select: { id: true },
    });
    if (clash) return { ok: false, error: "That PAN is registered to another Business Associate." };
  }
  if (acct) {
    const clash = await prisma.businessAssociateProfile.findFirst({
      where: { accountNumber: acct, id: { not: p.id } },
      select: { id: true },
    });
    if (clash)
      return { ok: false, error: "That bank account is registered to another Business Associate." };
  }

  await prisma.businessAssociateProfile.update({
    where: { id: p.id },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      contactNumber: input.contactNumber,
      email: input.email,
      pincode: input.pincode,
      state: input.state,
      city: input.city,
      panNumber: pan,
      panDocKey: norm(input.panDocKey),
      bankName: norm(input.bankName),
      bankBranch: norm(input.bankBranch),
      accountHolderName: norm(input.accountHolderName),
      accountNumber: acct,
      ifsc: norm(input.ifsc),
      chequeDocKey: norm(input.chequeDocKey),
    },
  });

  await writeAuditLog({
    actorId: adminUserId,
    actorRole: "ADMIN",
    action: "BA_ADMIN_EDIT",
    entityType: "BusinessAssociateProfile",
    entityId: p.id,
  });
  return { ok: true };
}

export type BaProgramSummary = {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  suspended: number;
  /** APPROVED or BANK_SUBMITTED but missing PAN or bank details — can't be paid out yet. */
  missingBankOrPanCount: number;
  /** Account disabled (User.isActive=false), independent of BA application status. */
  inactiveCount: number;
  /** Distinct BAs with at least one ELIGIBLE (redeemable, not yet settled) earning. */
  payoutsDueCount: number;
};

/** Powers the Business Associates list's stat cards + alert banners — counts across the WHOLE table, same convention as getDealerApplicationsSummary/getSellerApplicationsSummary. */
export async function getBaProgramSummary(): Promise<BaProgramSummary> {
  const [grouped, missingBankOrPanCount, inactiveCount, payoutsDueRows] = await Promise.all([
    prisma.businessAssociateProfile.groupBy({
      by: ["status"],
      where: { user: { deletedAt: null } },
      _count: true,
    }),
    prisma.businessAssociateProfile.count({
      where: {
        user: { deletedAt: null },
        status: { in: ["APPROVED", "BANK_SUBMITTED"] },
        OR: [{ panNumber: null }, { bankName: null }, { accountNumber: null }, { ifsc: null }],
      },
    }),
    prisma.businessAssociateProfile.count({
      where: { user: { isActive: false, deletedAt: null } },
    }),
    prisma.baEarning.groupBy({
      by: ["baId"],
      where: { status: "ELIGIBLE", ba: { user: { deletedAt: null } } },
      _count: true,
    }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Record<
    BaStatus,
    number
  >;
  return {
    total: grouped.reduce((sum, g) => sum + g._count, 0),
    approved: (byStatus.APPROVED ?? 0) + (byStatus.BANK_SUBMITTED ?? 0),
    pending: byStatus.PENDING ?? 0,
    rejected: byStatus.REJECTED ?? 0,
    suspended: byStatus.SUSPENDED ?? 0,
    missingBankOrPanCount,
    inactiveCount,
    payoutsDueCount: payoutsDueRows.length,
  };
}

export type BaListFilters = {
  status?: BaStatus;
  q?: string;
  isActive?: boolean;
  take?: number;
  skip?: number;
};

export async function listBusinessAssociates(filters: BaListFilters = {}) {
  const where: Prisma.BusinessAssociateProfileWhereInput = {
    user: {
      deletedAt: null,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { referralCode: { contains: filters.q, mode: "insensitive" } },
            { firstName: { contains: filters.q, mode: "insensitive" } },
            { lastName: { contains: filters.q, mode: "insensitive" } },
            { email: { contains: filters.q, mode: "insensitive" } },
            { contactNumber: { contains: filters.q } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.businessAssociateProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(filters.take ?? 50, 200),
      skip: filters.skip ?? 0,
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
            role: true,
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
        _count: { select: { referredCustomers: true, earnings: true } },
      },
    }),
    prisma.businessAssociateProfile.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      ...toView(r),
      userPhone: r.user.phone,
      userRole: r.user.role,
      userIsActive: r.user.isActive,
      deletionRequestedAt: r.user.deletionRequestedAt,
      deletionScheduledFor: r.user.deletionScheduledFor,
      deletionStatus: r.user.accountDeletionRequests[0]?.status ?? null,
      userName: getFullName(r.user) ?? r.user.phone ?? "—",
      referredCount: r._count.referredCustomers,
      earningCount: r._count.earnings,
    })),
    total,
  };
}

/**
 * Called from the dealer-approval path (packages/auth) when a referred user
 * becomes an approved dealer — credits the BA's approval bonus (spec #5:
 * on final approval only). No-op if the user has no BA referrer.
 */
export async function onReferredUserBecameDealer(referredUserId: string): Promise<void> {
  await accrueDealerApprovalEarning({ referredUserId });
}
