import { prisma, Prisma } from "@kisan4u/db";
import { deleteStoredFile } from "@kisan4u/providers";
import { cancelOpenProposedOrdersForAccount } from "../ba/proposed-order";
import { getAccountDeletionEligibility } from "./eligibility";

const REDACTED_MOBILE = "REDACTED";

class WalletForfeitureConsentRequiredError extends Error {}

function maskBankSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskBankSnapshot);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (/account(number)?/i.test(key) && typeof child === "string") {
          return [key, child.length > 4 ? `****${child.slice(-4)}` : "****"];
        }
        return [key, maskBankSnapshot(child)];
      }),
    );
  }
  return value;
}

export async function finalizeAccountDeletion(userId: string) {
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      deletedAt: true,
      deletionScheduledFor: true,
      dealerProfile: { select: { gstDocUrl: true, licenseDocUrl: true } },
      sellerProfile: {
        select: {
          gstDocUrl: true,
          panDocUrl: true,
          licenceSubmissions: { select: { id: true, documentStorageKey: true } },
        },
      },
      baProfile: {
        select: {
          id: true,
          panDocKey: true,
          chequeDocKey: true,
          payouts: { select: { id: true, bankSnapshot: true } },
        },
      },
    },
  });
  if (!before) return { ok: false as const, error: "Account not found." };
  if (before.deletedAt) return { ok: true as const, alreadyCompleted: true as const };
  if (!before.deletionScheduledFor || before.deletionScheduledFor.getTime() > Date.now()) {
    return { ok: false as const, error: "Account deletion is not due yet." };
  }

  const eligibility = await getAccountDeletionEligibility(userId);
  if (!eligibility) return { ok: false as const, error: "Account not found." };
  if (!eligibility.eligible) {
    await prisma.accountDeletionRequest.updateMany({
      where: { userId, status: { in: ["SCHEDULED", "BLOCKED"] } },
      data: {
        status: "BLOCKED",
        blockersSnapshot: eligibility.blockers as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: false as const, blocked: true as const, eligibility };
  }

  const activeRequest = await prisma.accountDeletionRequest.findFirst({
    where: { userId, status: { in: ["SCHEDULED", "BLOCKED"] } },
    orderBy: { requestedAt: "desc" },
    select: { id: true, walletForfeitureAccepted: true },
  });
  if (eligibility.walletBalance > 0 && !activeRequest?.walletForfeitureAccepted) {
    const walletBlocker = {
      code: "WALLET_FORFEITURE_CONSENT_REQUIRED",
      message: "Use the wallet balance or confirm that it may be forfeited before deletion.",
    };
    await prisma.accountDeletionRequest.updateMany({
      where: { userId, status: { in: ["SCHEDULED", "BLOCKED"] } },
      data: { status: "BLOCKED", blockersSnapshot: [walletBlocker] },
    });
    return { ok: false as const, blocked: true as const, eligibility };
  }

  await cancelOpenProposedOrdersForAccount(userId);

  const files = [
    before.dealerProfile?.gstDocUrl,
    before.dealerProfile?.licenseDocUrl,
    before.sellerProfile?.gstDocUrl,
    before.sellerProfile?.panDocUrl,
    before.baProfile?.panDocKey,
    before.baProfile?.chequeDocKey,
    ...(before.sellerProfile?.licenceSubmissions.map((item) => item.documentStorageKey) ?? []),
  ].filter((value): value is string => Boolean(value));

  let completed: { requestId: string | null } | null;
  try {
    completed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { phone: true, role: true, deletedAt: true },
      });
      if (!user || user.deletedAt) return null;

      const wallet = await tx.wallet.findUnique({ where: { ownerId: userId } });
      const forfeitedBalance = wallet ? Number(wallet.balance) : 0;
      if (forfeitedBalance > 0) {
        if (!activeRequest?.walletForfeitureAccepted) {
          throw new WalletForfeitureConsentRequiredError();
        }
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet!.id },
          data: { balance: 0 },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet!.id,
            type: "DEBIT",
            reason: "ACCOUNT_DELETION_FORFEITURE",
            amount: forfeitedBalance,
            balanceAfter: updatedWallet.balance,
            referenceType: "account_deletion",
            referenceId: activeRequest.id,
          },
        });
      }

      await Promise.all([
        tx.customerAddress.deleteMany({ where: { userId } }),
        tx.cartItem.deleteMany({ where: { userId } }),
        tx.wishlistItem.deleteMany({ where: { userId } }),
        tx.notification.deleteMany({ where: { userId } }),
        tx.notificationPreference.deleteMany({ where: { userId } }),
        tx.pushDevice.deleteMany({ where: { userId } }),
        tx.cartReminder.deleteMany({ where: { userId } }),
        tx.restockSubscription.deleteMany({ where: { userId } }),
        ...(user.phone
          ? [
              tx.otpCode.deleteMany({ where: { phone: user.phone } }),
              tx.dealerOnboardingSession.deleteMany({ where: { phone: user.phone } }),
            ]
          : []),
      ]);

      await tx.orderAddressSnapshot.updateMany({
        where: { checkoutGroup: { customerId: userId } },
        data: { mobile: REDACTED_MOBILE, altMobile: null },
      });

      if (before.dealerProfile) {
        await tx.dealerProfile.update({
          where: { userId },
          data: {
            status: "INACTIVE",
            kycStatus: "NOT_SUBMITTED",
            gstNumber: null,
            gstDocUrl: null,
            licenseNumber: null,
            licenseDocUrl: null,
            storeName: null,
            storeAddress: null,
            city: null,
            state: null,
            stateId: null,
            pincode: null,
            pendingChanges: Prisma.DbNull,
            additionalDocuments: Prisma.DbNull,
            rejectionReason: null,
          },
        });
      }

      if (before.sellerProfile) {
        await tx.sellerProfile.update({
          where: { userId },
          data: {
            shopName: "Deleted Seller",
            contactPersonName: null,
            companyWebsite: null,
            registeredAddress: null,
            registeredAddressLine1: null,
            registeredAddressLine2: null,
            registeredCity: null,
            registeredDistrict: null,
            registeredState: null,
            registeredPincode: null,
            contactEmail: null,
            contactMobile: null,
            gstNumber: null,
            gstDocUrl: null,
            panNumber: null,
            panDocUrl: null,
            bankName: null,
            accountHolder: null,
            accountNumber: null,
            ifscCode: null,
            bankBranch: null,
            status: "INACTIVE",
          },
        });
        for (const document of before.sellerProfile.licenceSubmissions) {
          await tx.sellerLicenceSubmission.update({
            where: { id: document.id },
            data: {
              documentStorageKey: `deleted/${document.id}`,
              documentMimeType: "application/octet-stream",
              documentSizeBytes: 0,
            },
          });
        }
      }

      if (before.baProfile) {
        await tx.businessAssociateProfile.update({
          where: { userId },
          data: {
            status: "SUSPENDED",
            firstName: "Deleted",
            lastName: "User",
            contactNumber: "",
            email: "",
            pincode: "",
            state: "",
            city: "",
            panNumber: null,
            panDocKey: null,
            bankName: null,
            bankBranch: null,
            accountHolderName: null,
            accountNumber: null,
            ifsc: null,
            chequeDocKey: null,
            bankSubmittedAt: null,
            bankStatus: "NOT_SUBMITTED",
            bankRejectionReason: null,
            suspendedAt: new Date(),
          },
        });
        for (const payout of before.baProfile.payouts) {
          await tx.baSettlement.update({
            where: { id: payout.id },
            data: { bankSnapshot: maskBankSnapshot(payout.bankSnapshot) as Prisma.InputJsonValue },
          });
        }
      }

      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: null,
          email: null,
          passwordHash: null,
          firstName: "Deleted",
          lastName: "User",
          isActive: false,
          isPhoneVerified: false,
          isEmailVerified: false,
          mustChangePassword: false,
          deletionScheduledFor: null,
          deletedAt: now,
          sessionVersion: { increment: 1 },
        },
      });
      const request = await tx.accountDeletionRequest.findFirst({
        where: { userId, status: { in: ["SCHEDULED", "BLOCKED"] } },
        orderBy: { requestedAt: "desc" },
      });
      if (request) {
        await tx.accountDeletionRequest.update({
          where: { id: request.id },
          data: {
            status: "COMPLETED",
            completedAt: now,
            scheduledFor: null,
            blockersSnapshot: Prisma.JsonNull,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: "ACCOUNT_DELETION_COMPLETED",
          entityType: "User",
          entityId: userId,
        },
      });
      return { requestId: request?.id ?? null };
    });
  } catch (error) {
    if (!(error instanceof WalletForfeitureConsentRequiredError)) throw error;
    await prisma.accountDeletionRequest.updateMany({
      where: { userId, status: { in: ["SCHEDULED", "BLOCKED"] } },
      data: {
        status: "BLOCKED",
        blockersSnapshot: [
          {
            code: "WALLET_FORFEITURE_CONSENT_REQUIRED",
            message: "Use the wallet balance or confirm that it may be forfeited before deletion.",
          },
        ],
      },
    });
    return { ok: false as const, blocked: true as const, eligibility };
  }

  const fileFailures: string[] = [];
  for (const file of files) {
    try {
      await deleteStoredFile(file);
    } catch {
      fileFailures.push(file);
    }
  }
  if (completed?.requestId && fileFailures.length > 0) {
    await prisma.accountDeletionRequest.update({
      where: { id: completed.requestId },
      data: { blockersSnapshot: { fileDeleteFailures: fileFailures } },
    });
  }
  return { ok: true as const, alreadyCompleted: false as const, fileFailures };
}

export async function sweepScheduledAccountDeletions() {
  const due = await prisma.user.findMany({
    where: { deletionScheduledFor: { lte: new Date() }, deletedAt: null },
    select: { id: true },
    take: 100,
  });
  let completed = 0;
  let blocked = 0;
  for (const user of due) {
    const result = await finalizeAccountDeletion(user.id).catch(() => null);
    if (result?.ok) completed += 1;
    else if (result && "blocked" in result && result.blocked) blocked += 1;
  }

  const completedWithFiles = await prisma.accountDeletionRequest.findMany({
    where: { status: "COMPLETED", blockersSnapshot: { not: Prisma.JsonNull } },
    select: { id: true, blockersSnapshot: true },
    orderBy: { completedAt: "asc" },
    take: 100,
  });
  let fileRetriesCompleted = 0;
  for (const request of completedWithFiles) {
    const snapshot = request.blockersSnapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
    const pending = (snapshot as { fileDeleteFailures?: unknown }).fileDeleteFailures;
    if (!Array.isArray(pending) || !pending.every((value) => typeof value === "string")) continue;
    const failures: string[] = [];
    for (const file of pending) {
      try {
        await deleteStoredFile(file);
      } catch {
        failures.push(file);
      }
    }
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        blockersSnapshot:
          failures.length > 0
            ? ({ fileDeleteFailures: failures } as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
    if (failures.length === 0) fileRetriesCompleted += 1;
  }

  return { checked: due.length, completed, blocked, fileRetriesCompleted };
}
