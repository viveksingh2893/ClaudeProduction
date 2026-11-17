import { prisma, type UserRole } from "@kisan4u/db";
import { recordStatusChange } from "./status-transitions";
import { writeAuditLog } from "./audit";
import { notifyUser } from "./notifications";
import type { MoneyValue } from "./money";

export type PosPaymentProofDecisionAction = "APPROVE" | "REJECT";
export type PosPaymentProofDecisionResult =
  | { ok: true; fullyApproved: boolean }
  | { ok: false; error: string };

/**
 * A buyer paying in instalments uploads one PosPaymentProofSubmission per
 * instalment ("slot"), each its own independent previousSubmissionId
 * revision chain — see the model's doc comment in schema.prisma. A
 * submission is "live" (still relevant to whether the group's payment is
 * proved) iff no other submission in the same set supersedes it, i.e. no
 * other submission's previousSubmissionId points at its id. This is the
 * single source of truth for that derivation — every caller (confirmOrder,
 * the upload action, every proof-listing query/page) must go through this
 * rather than re-deriving it, so "live" always means the same thing.
 */
export function selectLivePaymentProofSubmissions<
  T extends { id: string; previousSubmissionId: string | null },
>(submissions: T[]): T[] {
  const supersededIds = new Set(
    submissions.map((s) => s.previousSubmissionId).filter((id): id is string => id != null),
  );
  return submissions.filter((s) => !supersededIds.has(s.id));
}

/**
 * The rupee amount POS payment-proof screenshots must cover for a
 * checkout group's payment — the amount payable now (`Payment.totalAmount`,
 * set to `chargeAmount` at checkout time, before wallet) minus whatever
 * the wallet already covered (`Payment.walletAmountApplied`). Wallet and
 * screenshots are two separate funding sources for the same
 * `chargeAmount` target, so a screenshot must never be asked to re-cover
 * the portion the wallet already paid.
 */
export function requiredPaymentProofAmount(payment: {
  totalAmount: MoneyValue;
  walletAmountApplied: MoneyValue;
}): number {
  return round2(Number(payment.totalAmount) - Number(payment.walletAmountApplied));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The group-level "is this checkout group's payment proved" predicate —
 * per the owner's spec, a checkout group is NOT considered
 * partially/fully paid until (a) every live slot has been decided
 * APPROVED (a single approved screenshot out of several is not enough,
 * and a still-PENDING or REJECTED slot blocks completion), AND (b) the
 * APPROVED slots' amounts actually SUM to at least `requiredAmount` (the
 * remaining-after-wallet balance — see requiredPaymentProofAmount). Two
 * screenshots individually approved for 50 and 40 against a required 100
 * must NOT be treated as fully paid — 10 is still owed. At least one live
 * submission must exist — an order with none uploaded is obviously not
 * proved. A small epsilon absorbs rupee rounding across instalments.
 */
export function isPaymentProofFullyApproved(
  liveSubmissions: { status: string; amount: MoneyValue }[],
  requiredAmount: number,
): boolean {
  if (liveSubmissions.length === 0) return false;
  if (!liveSubmissions.every((s) => s.status === "APPROVED")) return false;
  const approvedTotal = liveSubmissions.reduce((sum, s) => sum + Number(s.amount), 0);
  return round2(approvedTotal) >= round2(requiredAmount) - 0.01;
}

/**
 * Admin/Payment-Verifier-staff decision on ONE POS payment-proof screenshot
 * (one instalment "slot" — see packages/db/prisma/schema.prisma's
 * PosPaymentProofSubmission doc comment). Caller (a Server Action) must
 * independently verify the actor is authorized before calling this — today
 * that's a plain ADMIN session or a STAFF session holding the
 * "payment-verification" EDIT permission (see requireAdminPermission) —
 * same convention as every other decision function in this codebase (e.g.
 * packages/catalog/src/licence-submissions.ts's decideSellerLicenceSubmission,
 * whose shape this mirrors). `actor.role` is recorded verbatim on the
 * resulting audit log / status history rows, so a Payment Verifier's
 * approval is never mislabeled as an ADMIN's.
 *
 * REJECT is cheap — just flips status + reason on that one slot, the order
 * stays at PENDING_PAYMENT and the agent can re-upload that slot alone;
 * every other slot (pending, approved, or already-superseded-rejected) is
 * untouched. APPROVE first flips just this slot to APPROVED, then checks
 * whether EVERY live slot for the checkout group is now APPROVED — only
 * then does it settle the money side, replicating the exact Payment
 * bookkeeping applyInitialPayment (checkout.ts) would have done at
 * checkout time had a real/mock payment succeeded there instead of being
 * deferred to this manual review — same Payment status transition, and a
 * partial advance recorded as PAYMENT_PARTIALLY_RECEIVED. It does NOT
 * confirm the order or deduct stock: like every other order, a POS order
 * then waits at "Pending" for Kisan4U's scheduling team to confirm it with
 * the customer (an admin runs order-workflow.ts's confirmOrder, which is
 * where CONFIRMED and the stock deduction happen — and which independently
 * re-checks the same "every live slot approved" gate).
 */
export async function decidePosPaymentProof(
  submissionId: string,
  decision: { action: PosPaymentProofDecisionAction; reason?: string },
  actor: { id: string; role: UserRole },
): Promise<PosPaymentProofDecisionResult> {
  const submission = await prisma.posPaymentProofSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      checkoutGroupId: true,
      uploadedById: true,
      checkoutGroup: {
        select: {
          sellerOrders: { select: { id: true, status: true, paymentMethod: true } },
          payments: { select: { id: true, totalAmount: true, walletAmountApplied: true } },
          paymentProofSubmissions: {
            select: { id: true, status: true, previousSubmissionId: true, amount: true },
          },
        },
      },
    },
  });
  if (!submission) return { ok: false, error: "Submission not found." };
  if (submission.status !== "PENDING") {
    return { ok: false, error: "Only a pending submission can be reviewed." };
  }

  if (decision.action === "REJECT") {
    if (!decision.reason?.trim()) return { ok: false, error: "A rejection reason is required." };

    await prisma.posPaymentProofSubmission.update({
      where: { id: submissionId },
      data: {
        status: "REJECTED",
        rejectionReason: decision.reason,
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "POS_PAYMENT_PROOF_REJECTED",
      entityType: "PosPaymentProofSubmission",
      entityId: submissionId,
      metadata: { checkoutGroupId: submission.checkoutGroupId },
      reason: decision.reason,
    });
    await notifyUser({
      userId: submission.uploadedById,
      title: "Payment proof rejected",
      body: `One of your uploaded payment screenshots was rejected: ${decision.reason}. Please upload a corrected screenshot for that amount — your other screenshots are unaffected.`,
    });
    return { ok: true, fullyApproved: false };
  }

  // APPROVE
  const payment = submission.checkoutGroup.payments[0];
  if (!payment) return { ok: false, error: "No payment found for this order." };
  const sellerOrders = submission.checkoutGroup.sellerOrders;
  if (sellerOrders.length === 0) return { ok: false, error: "No orders found for this checkout." };
  const isPartial = sellerOrders[0]!.paymentMethod === "ONLINE_PARTIAL";
  const actorCtx = { id: actor.id, role: actor.role };

  // Every OTHER live slot's real status, plus this one patched to APPROVED
  // in-memory (cheaper and just as correct as a re-query inside the
  // transaction, since nothing else can concurrently decide a slot this
  // function isn't already holding — decisions are single-slot and
  // PENDING-gated above).
  const liveSubmissions = selectLivePaymentProofSubmissions(
    submission.checkoutGroup.paymentProofSubmissions,
  ).map((s) => (s.id === submissionId ? { ...s, status: "APPROVED" } : s));
  const requiredAmount = requiredPaymentProofAmount(payment);
  const fullyApproved = isPaymentProofFullyApproved(liveSubmissions, requiredAmount);
  const approvedTotal = round2(
    liveSubmissions.reduce((sum, s) => sum + Number(s.amount), 0),
  );

  await prisma.$transaction(async (tx) => {
    await tx.posPaymentProofSubmission.update({
      where: { id: submissionId },
      data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date() },
    });

    if (!fullyApproved) return; // wait for every other slot before touching Payment/order status

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: isPartial ? "PARTIALLY_PAID" : "PAID",
        // Wallet + approved screenshots — the two funding sources that
        // together prove chargeAmount, not a blind copy of totalAmount
        // (which would silently ignore any rounding drift between the
        // screenshots' claimed amounts and the required remainder).
        amountPaid: round2(Number(payment.walletAmountApplied) + approvedTotal),
        providerReference: `POS-MANUAL-APPROVAL:${submissionId}`,
      },
    });
    await tx.paymentStatusHistory.create({
      data: {
        paymentId: payment.id,
        status: isPartial ? "PARTIALLY_PAID" : "PAID",
        source: "ADMIN",
        note: "POS payment proof approved (all screenshots)",
      },
    });

    for (const order of sellerOrders) {
      if (order.status !== "PENDING_PAYMENT") continue; // already advanced — safe no-op, not an error
      if (isPartial) {
        const step1 = await recordStatusChange(
          tx,
          order.id,
          "PENDING_PAYMENT",
          "PAYMENT_PARTIALLY_RECEIVED",
          actorCtx,
          "ADMIN",
          "POS payment proof approved (all screenshots)",
        );
        if (!step1.ok) throw new Error(step1.error);
      }
      // Full payment: order stays PENDING_PAYMENT. Confirmation and the
      // stock deduction happen later, when an admin runs confirmOrder.
    }
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "POS_PAYMENT_PROOF_APPROVED",
    entityType: "PosPaymentProofSubmission",
    entityId: submissionId,
    metadata: { checkoutGroupId: submission.checkoutGroupId, fullyApproved },
  });
  await notifyUser({
    userId: submission.uploadedById,
    title: "Payment proof approved",
    body: fullyApproved
      ? "All your uploaded payment screenshots have been approved. The order is now awaiting confirmation by the Kisan4U team."
      : "One of your uploaded payment screenshots has been approved. The order isn't confirmed yet — your other screenshot(s) still need review.",
  });

  return { ok: true, fullyApproved };
}
