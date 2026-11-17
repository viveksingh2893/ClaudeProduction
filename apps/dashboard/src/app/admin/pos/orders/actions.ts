"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@kisan4u/db";
import { validatePosPaymentProofImage, uploadPrivateDocument } from "@kisan4u/providers";
import {
  selectLivePaymentProofSubmissions,
  isPaymentProofFullyApproved,
  requiredPaymentProofAmount,
} from "@kisan4u/orders";
import { requirePosAccess } from "@/lib/pos-guard";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Uploads ONE payment-proof screenshot ("slot") for a POS order. A buyer
 * paying in instalments (e.g. 1000 collected as 200+300+500) means the
 * agent calls this once per instalment — each call either opens a brand
 * new slot (`replacesSubmissionId` omitted) or replaces one specific
 * REJECTED slot (`replacesSubmissionId` set to that slot's id, re-chained
 * via previousSubmissionId) — every other slot for the checkout group is
 * completely untouched either way. The agent who placed the order can
 * upload for that order only (ownership re-verified here independently of
 * the page-level check — same "a Server Action can be invoked on its own,
 * so it must re-check too" discipline as every other action in this app);
 * an ADMIN can upload for ANY POS order (e.g. when they've collected the
 * screenshot from the agent externally and are entering it on the agent's
 * behalf). Once every live slot is already APPROVED there's nothing left
 * to prove, so further uploads are refused.
 */
export async function uploadPosPaymentProofAction(
  checkoutGroupId: string,
  formData: FormData,
): Promise<Result> {
  const session = await requirePosAccess();
  const isAdmin = session.user.role === "ADMIN";

  const group = await prisma.checkoutGroup.findFirst({
    where: { id: checkoutGroupId, ...(isAdmin ? {} : { placedByUserId: session.user.id }) },
    select: {
      payments: {
        select: { id: true, totalAmount: true, amountPaid: true, walletAmountApplied: true },
        take: 1,
      },
      paymentProofSubmissions: {
        select: { id: true, status: true, previousSubmissionId: true, amount: true },
      },
    },
  });
  if (!group) return { ok: false, error: "Order not found." };
  const payment = group.payments[0];
  if (!payment) return { ok: false, error: "No payment found for this order." };

  const requiredAmount = requiredPaymentProofAmount(payment);
  const liveSubmissions = selectLivePaymentProofSubmissions(group.paymentProofSubmissions);
  if (isPaymentProofFullyApproved(liveSubmissions, requiredAmount)) {
    return { ok: false, error: "Every screenshot for this order has already been approved." };
  }
  // What's still unaccounted for — required minus whatever's already
  // claimed by a live (pending or approved) slot. A rejected slot doesn't
  // count against this: it'll be replaced, not stacked on top of.
  const alreadyClaimed = liveSubmissions
    .filter((s) => s.status !== "REJECTED")
    .reduce((sum, s) => sum + Number(s.amount), 0);
  const remaining = Math.round((requiredAmount - alreadyClaimed + Number.EPSILON) * 100) / 100;

  // Adding a brand-new slot (replacesSubmissionId omitted) is always
  // allowed alongside other pending/approved slots — that's the whole
  // point of instalments. Only replacing a specific rejected slot needs
  // validation here.
  const replacesSubmissionId = formData.get("replacesSubmissionId");
  let previousSubmissionId: string | undefined;
  if (typeof replacesSubmissionId === "string" && replacesSubmissionId.length > 0) {
    const target = liveSubmissions.find((s) => s.id === replacesSubmissionId);
    if (!target) return { ok: false, error: "That screenshot slot no longer exists." };
    if (target.status !== "REJECTED") {
      return { ok: false, error: "Only a rejected screenshot can be replaced." };
    }
    previousSubmissionId = target.id;
  }

  const amountRaw = formData.get("amount");
  const amount = typeof amountRaw === "string" ? Number(amountRaw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter the amount this screenshot covers." };
  }
  if (amount > remaining + 0.01) {
    return {
      ok: false,
      error: `That amount is more than the ₹${remaining.toFixed(2)} still remaining on this order (wallet and any other screenshots already cover the rest).`,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  const validationError = await validatePosPaymentProofImage(file);
  if (validationError) {
    return {
      ok: false,
      error:
        validationError === "FILE_TOO_LARGE"
          ? "File is too large — the maximum size is 5MB."
          : validationError === "CONTENT_MISMATCH"
            ? "File content doesn't match its extension."
            : "Unsupported file type — upload a JPEG, PNG, or WEBP image.",
    };
  }

  const uploaded = await uploadPrivateDocument(file, `pos-payment-proofs/${checkoutGroupId}`);
  await prisma.posPaymentProofSubmission.create({
    data: {
      checkoutGroupId,
      amount,
      screenshotStorageKey: uploaded.storageKey,
      screenshotMimeType: uploaded.mimeType,
      screenshotSizeBytes: uploaded.sizeBytes,
      uploadedById: session.user.id,
      previousSubmissionId,
    },
  });

  revalidatePath(`/admin/pos/orders/${checkoutGroupId}`);
  revalidatePath("/admin/pos/orders");
  revalidatePath(`/admin/orders`);
  return { ok: true };
}
