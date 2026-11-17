import { createHmac } from "node:crypto";
import { prisma, Prisma, type AccountDeletionSource } from "@kisan4u/db";
import { getSmsProvider } from "@kisan4u/providers";
import { getAccountDeletionEligibility } from "./eligibility";

const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

function identityHash(value: string | null): string | null {
  if (!value) return null;
  const pepper = process.env.ACCOUNT_DELETION_PEPPER;
  if (!pepper) throw new Error("ACCOUNT_DELETION_PEPPER is not configured.");
  return createHmac("sha256", pepper).update(value.trim().toLowerCase()).digest("hex");
}

export async function requestAccountDeletion(input: {
  userId: string;
  source?: AccountDeletionSource;
  reason?: string;
  immediate?: boolean;
  forfeitWalletBalance?: boolean;
}) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`);
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, phone: true, email: true, deletionRequestedAt: true },
    });
    if (!user) return { ok: false as const, error: "Account not found." };

    const existing = await tx.accountDeletionRequest.findFirst({
      where: { userId: input.userId, status: { in: ["SCHEDULED", "BLOCKED", "PENDING_REVIEW"] } },
      orderBy: { requestedAt: "desc" },
    });
    if (existing)
      return { ok: true as const, request: existing, phone: user.phone, existing: true as const };

    const eligibility = await getAccountDeletionEligibility(input.userId, tx);
    if (!eligibility) return { ok: false as const, error: "Account not found." };
    if (!eligibility.eligible) {
      return {
        ok: false as const,
        error: "Resolve the account blockers before requesting deletion.",
        eligibility,
      };
    }
    if (eligibility.walletBalance > 0 && !input.forfeitWalletBalance) {
      return {
        ok: false as const,
        error:
          "Use your wallet balance first or confirm that the remaining balance will be forfeited.",
        eligibility,
      };
    }

    const source = input.source ?? "SELF";
    const status =
      eligibility.requiresManualReview && source === "SELF" ? "PENDING_REVIEW" : "SCHEDULED";
    const scheduledFor =
      status === "SCHEDULED"
        ? new Date(now.getTime() + (input.immediate ? 0 : GRACE_PERIOD_MS))
        : null;

    const request = await tx.accountDeletionRequest.create({
      data: {
        userId: input.userId,
        source,
        status,
        reason: input.reason?.trim() || null,
        requestedAt: now,
        scheduledFor,
        phoneHash: identityHash(user.phone),
        emailHash: identityHash(user.email),
        blockersSnapshot: eligibility.blockers as unknown as Prisma.InputJsonValue,
        walletForfeitureAccepted: input.forfeitWalletBalance === true,
      },
    });
    let forfeitedWalletBalance = 0;
    if (input.forfeitWalletBalance && eligibility.walletBalance > 0) {
      const wallet = await tx.wallet.findUnique({ where: { ownerId: input.userId } });
      forfeitedWalletBalance = wallet ? Number(wallet.balance) : 0;
      if (wallet && forfeitedWalletBalance > 0) {
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: 0 },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "DEBIT",
            reason: "ACCOUNT_DELETION_FORFEITURE",
            amount: forfeitedWalletBalance,
            balanceAfter: updatedWallet.balance,
            referenceType: "account_deletion_request",
            referenceId: request.id,
          },
        });
      }
    }
    await tx.user.update({
      where: { id: input.userId },
      data: {
        deletionRequestedAt: now,
        deletionScheduledFor: scheduledFor,
        sessionVersion: { increment: 1 },
      },
    });
    await tx.pushDevice.deleteMany({ where: { userId: input.userId } });
    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        actorRole: eligibility.role,
        action: "ACCOUNT_DELETION_REQUESTED",
        entityType: "User",
        entityId: input.userId,
        reason: input.reason?.trim() || null,
        metadata: {
          requestId: request.id,
          status,
          scheduledFor: scheduledFor?.toISOString() ?? null,
          forfeitedWalletBalance,
        },
      },
    });
    return { ok: true as const, request, phone: user.phone, existing: false as const };
  });

  if (result.ok && !result.existing && result.phone) {
    const when = result.request.scheduledFor
      ? result.request.scheduledFor.toLocaleDateString("en-IN")
      : "after administrator review";
    await getSmsProvider()
      .send(
        result.phone,
        `Your Kisan4U account deletion is scheduled ${when}. Log in before deletion to restore your account.`,
      )
      .catch(() => {});
  }
  return result;
}

export async function restoreAccount(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true, deletedAt: true },
    });
    if (!user) return { ok: false as const, error: "Account not found." };
    if (user.deletedAt)
      return { ok: false as const, error: "This account has already been deleted." };

    const request = await tx.accountDeletionRequest.findFirst({
      where: { userId, status: { in: ["SCHEDULED", "BLOCKED", "PENDING_REVIEW"] } },
      orderBy: { requestedAt: "desc" },
      select: { id: true },
    });
    if (!request) return { ok: false as const, error: "No pending deletion request was found." };

    await tx.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", scheduledFor: null },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: null,
        deletionScheduledFor: null,
        sessionVersion: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: user.role,
        action: "ACCOUNT_DELETION_CANCELLED",
        entityType: "User",
        entityId: userId,
        metadata: { requestId: request.id },
      },
    });
    return { ok: true as const };
  });
}
