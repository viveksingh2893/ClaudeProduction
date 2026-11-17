"use server";

import { revalidatePath } from "next/cache";
import { setSellerCommission, adminResetPassword } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";
import { markSettlementsSettled, reverseSettlement, writeAuditLog } from "@kisan4u/orders";
import { prisma, type SettlementAdjustmentReason } from "@kisan4u/db";
import {
  deletePrivateDocument,
  uploadSellerAgreement,
  validateSellerAgreement,
} from "@kisan4u/providers";

type Result = { ok: true } | { ok: false; error: string };

/** Admin-only — sets this seller's customer-order and dealer-order commission rates independently. */
export async function setSellerCommissionAction(
  profileId: string,
  commissionPercent: number,
  dealerCommissionPercent: number,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  return setSellerCommission({ profileId, commissionPercent, dealerCommissionPercent });
}

/**
 * Admin-only — issues a fresh temporary password for this seller's login
 * account, forces them to change it on next login, and signs out any
 * session already active under the old password. `userId` is the User id
 * (not the SellerProfile id the route param is) — the caller resolves it
 * from the loaded seller before rendering the button.
 */
export async function resetSellerPasswordAction(
  userId: string,
): Promise<Result & { temporaryPassword?: string }> {
  const session = await requireSession(["ADMIN"]);
  const result = await adminResetPassword(userId, { id: session.user.id, role: "ADMIN" });
  return result.ok
    ? { ok: true, temporaryPassword: result.temporaryPassword }
    : { ok: false, error: result.error };
}

/**
 * Admin-only, server-authorized, auditable — no real payout integration
 * exists yet, so SETTLED only ever happens through this explicit action.
 * Only ever promotes rows that are currently ELIGIBLE.
 */
export async function markSettlementsSettledAction(
  settlementIds: string[],
): Promise<Result & { count?: number }> {
  const session = await requireSession(["ADMIN"]);
  return markSettlementsSettled(settlementIds, { id: session.user.id, role: "ADMIN" });
}

/**
 * Admin-only — creates an append-only SettlementAdjustment (see
 * packages/orders/src/settlement.ts:reverseSettlement) rather than
 * mutating the original settlement. Omit `amount` for a full reversal.
 */
export async function reverseSettlementAction(
  settlementId: string,
  reason: SettlementAdjustmentReason,
  note: string,
  amount?: number,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await reverseSettlement({
    settlementId,
    reason,
    amount,
    actor: { id: session.user.id, role: "ADMIN" },
    note: note || undefined,
    referenceType: "AdminManualAction",
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Admin-only — uploads (or replaces) this seller's signed agreement PDF.
 * Private storage (see @kisan4u/providers' uploadSellerAgreement); the
 * seller views it under Account → Agreement, both through the
 * authenticated /api/seller-agreement/[sellerProfileId] route.
 */
export async function uploadSellerAgreementAction(
  sellerProfileId: string,
  formData: FormData,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a PDF to upload." };

  const validationError = await validateSellerAgreement(file);
  if (validationError === "FILE_TOO_LARGE") return { ok: false, error: "The PDF must be 8 MB or smaller." };
  if (validationError) return { ok: false, error: "Only PDF files can be uploaded." };

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { id: true, agreementStorageKey: true },
  });
  if (!seller) return { ok: false, error: "Seller not found." };

  const uploaded = await uploadSellerAgreement(file, seller.id);
  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: {
      agreementStorageKey: uploaded.storageKey,
      agreementFileName: file.name.slice(0, 200),
      agreementUploadedAt: new Date(),
    },
  });
  // The previous version is replaced, not kept.
  if (seller.agreementStorageKey) await deletePrivateDocument(seller.agreementStorageKey);
  await writeAuditLog({
    actorId: session.user.id,
    actorRole: "ADMIN",
    action: seller.agreementStorageKey ? "SELLER_AGREEMENT_REPLACED" : "SELLER_AGREEMENT_UPLOADED",
    entityType: "SellerProfile",
    entityId: seller.id,
    metadata: { fileName: file.name, sizeBytes: file.size },
  });
  revalidatePath(`/admin/sellers/${seller.id}`);
  revalidatePath("/seller/agreement");
  return { ok: true };
}
