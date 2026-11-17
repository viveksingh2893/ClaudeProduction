import {
  prisma,
  Prisma,
  type UserRole,
  type OrderStatus,
  type PaymentMethod,
  type RefundStatus,
  type RefundMethod,
} from "@kisan4u/db";
import { razorpayCreateRefund } from "@kisan4u/providers";
import type {
  RequestReturnInput,
  DecideReturnRequestInput,
  CompleteRefundInput,
} from "@kisan4u/validators";
import { recordStatusChange } from "./status-transitions";
import { writeAuditLog } from "./audit";
import { notifyBuyer } from "./notifications";
import { refundWalletAmount } from "./wallet";
import { reverseLoyaltyPointsForOrderItem } from "./loyalty-points";
import { round2 } from "./money";
import { paidSoFarFor } from "./payment-collection";
import { resolveReturnWindowMs } from "./settlement-rates";
import { voidSettlementForReturnedItem } from "./settlement";

/**
 * The real, non-wallet money captured so far for an order — same figure
 * paidSoFarFor computes (which includes any wallet-funded portion, since
 * Payment.amountPaid itself is amountCaptured+walletApplied — see
 * checkout.ts), minus each allocation's own walletAmountApplied. This is
 * what a pre-delivery cancellation actually needs to refund through a
 * real payment method (Wallet or Original Source) — the wallet-funded
 * slice is already handled separately, by cancellation.ts's own existing
 * per-allocation refundWalletAmount loop, unrelated to this.
 */
export function nonWalletPaidSoFarFor(
  allocations: {
    amount: unknown;
    remainingCollectedAmount: unknown;
    walletAmountApplied: unknown;
    payment: { amountPaid: unknown; totalAmount: unknown };
  }[],
): number {
  const total = paidSoFarFor(allocations);
  const walletPortion = allocations.reduce((sum, a) => sum + Number(a.walletAmountApplied), 0);
  return round2(Math.max(0, total - walletPortion));
}

export type RefundResult = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Post-delivery return/refund workflow (Phase "finalize returns" — the
 * counterpart to cancellation.ts, which only ever handles pre-delivery
 * cancellation). RETURN_REQUESTED/RETURN_APPROVED/RETURN_REJECTED/
 * REFUND_INITIATED/REFUND_COMPLETED were reserved in the OrderStatus enum
 * since Phase 4 planning but had no transition rules or implementation
 * until now — see status-transitions.ts's TRANSITIONS map.
 *
 * REPLACEMENT_APPROVED/REPLACEMENT_DISPATCHED are deliberately still
 * unreachable — replacing an item means dispatching a brand new shipment,
 * a separate fulfillment-tracking problem this pass doesn't attempt.
 */

/**
 * WALLET is always allowed — no external dependency. ORIGINAL_SOURCE only
 * makes sense if the order actually had an electronic payment component
 * (refunded back through the gateway to whatever card/UPI/netbanking
 * source paid it); COD has no such source, so it's blocked there in favor
 * of BANK_TRANSFER, the only way to return COD-collected cash.
 */
export function validateRefundMethodForOrder(
  method: RequestReturnInput["refundMethod"],
  paymentMethod: PaymentMethod,
): string | null {
  if (method === "WALLET") return null;
  if (method === "ORIGINAL_SOURCE" && paymentMethod === "COD") {
    return "This order was paid by Cash on Delivery — there's no original electronic source to refund to. Choose Wallet or Bank Transfer instead.";
  }
  if (method === "BANK_TRANSFER" && paymentMethod !== "COD") {
    return "Bank transfer is only for a Cash on Delivery order. Choose Wallet or Original Source instead.";
  }
  return null;
}

export type RefundChoice = {
  method: RefundMethod;
  label: string;
  /** The admin must type a payment-app / bank reference — the money moves outside the app. */
  needsReference: boolean;
};

export type RefundChoiceContext = {
  /** Placed by dashboard staff through POS (not a BA — see admin-order-row.ts's isPosOrder). */
  isPos: boolean;
  /** The method the buyer picked themselves: always set for a return, set for a cancellation only when they requested it (SellerOrder.cancellationRefundMethod). Null for an admin cancel or an RTO. */
  buyerChoice: RefundMethod | null;
  paymentMethod: PaymentMethod;
  /** A real Razorpay payment exists to refund back through. */
  hasGatewayPayment: boolean;
};

const REFUND_CHOICE_LABEL: Record<RefundMethod, string> = {
  WALLET: "Refund to wallet",
  ORIGINAL_SOURCE: "Razorpay refund",
  BANK_TRANSFER: "Bank transfer",
};

/**
 * The refund methods an admin may complete a cancel / return / RTO refund
 * with — the refund dropdown on the orders + order-scheduling tables and
 * the order page, and enforced by completeRefund:
 *  - POS order: "Refund manually" (money returned outside the app, with a
 *    reference) or "Refund to wallet".
 *  - The buyer already chose (web/app cancellation request, or any
 *    return): only that method.
 *  - Nobody chose (admin cancelled it, or the courier RTO'd it): wallet,
 *    or Razorpay when there's a real Razorpay payment to refund.
 * More than one choice means the admin has to decide, so the refund waits
 * for them instead of auto-completing (autoCompleteCancellationRefund).
 */
export function refundChoicesFor(ctx: RefundChoiceContext): RefundChoice[] {
  if (ctx.isPos) {
    return [
      {
        method: ctx.paymentMethod === "COD" ? "BANK_TRANSFER" : "ORIGINAL_SOURCE",
        label: "Refund manually",
        needsReference: true,
      },
      { method: "WALLET", label: REFUND_CHOICE_LABEL.WALLET, needsReference: false },
    ];
  }
  const needsReference = (method: RefundMethod) =>
    method === "BANK_TRANSFER" || (method === "ORIGINAL_SOURCE" && !ctx.hasGatewayPayment);
  if (ctx.buyerChoice) {
    return [
      {
        method: ctx.buyerChoice,
        label: `${REFUND_CHOICE_LABEL[ctx.buyerChoice]} (buyer's choice)`,
        needsReference: needsReference(ctx.buyerChoice),
      },
    ];
  }
  const choices: RefundChoice[] = [
    { method: "WALLET", label: REFUND_CHOICE_LABEL.WALLET, needsReference: false },
  ];
  if (ctx.hasGatewayPayment) {
    choices.push({
      method: "ORIGINAL_SOURCE",
      label: REFUND_CHOICE_LABEL.ORIGINAL_SOURCE,
      needsReference: false,
    });
  }
  return choices;
}

async function loadRefundChoiceContext(refundRequest: {
  sellerOrderId: string;
  orderItemId: string | null;
  refundMethod: RefundMethod;
}): Promise<RefundChoiceContext | null> {
  const order = await prisma.sellerOrder.findUnique({
    where: { id: refundRequest.sellerOrderId },
    select: {
      paymentMethod: true,
      placedByUserId: true,
      cancellationRefundMethod: true,
      checkoutGroup: {
        select: { placedByUser: { select: { staffProfile: { select: { id: true } } } } },
      },
      paymentAllocations: { select: { payment: { select: { razorpayPaymentId: true } } } },
    },
  });
  if (!order) return null;
  return {
    isPos: order.placedByUserId != null && order.checkoutGroup.placedByUser?.staffProfile != null,
    buyerChoice: refundRequest.orderItemId ? refundRequest.refundMethod : order.cancellationRefundMethod,
    paymentMethod: order.paymentMethod,
    hasGatewayPayment: order.paymentAllocations.some((a) => a.payment.razorpayPaymentId != null),
  };
}

/**
 * Customer (or dealer) requests a return for a single delivered line item.
 * One request per item at a time — a second request can't be filed while
 * one is already PENDING/APPROVED for the same item.
 */
export async function requestReturn(
  customerId: string,
  actorRole: UserRole,
  input: RequestReturnInput,
): Promise<RefundResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, customerId },
    include: {
      items: true,
      statusHistory: { where: { status: "DELIVERED" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "DELIVERED") {
    return { ok: false, error: "Only a delivered order can be returned." };
  }

  // Returns are only accepted inside the post-delivery window (the same
  // 48h SettlementSettings.holdDays knob that gates settlement eligibility
  // — see settlement-rates.ts:resolveReturnWindowMs). This keeps every
  // approvable return against a still-PENDING settlement that can be
  // cleanly voided, so the settlement cycles never need to pay out and
  // then claw back.
  const deliveredAt = order.statusHistory[0]?.createdAt ?? null;
  if (deliveredAt) {
    const windowMs = await resolveReturnWindowMs();
    if (Date.now() > deliveredAt.getTime() + windowMs) {
      const hours = Math.round(windowMs / (60 * 60 * 1000));
      return {
        ok: false,
        error: `The ${hours}-hour return window for this order has closed.`,
      };
    }
  }

  const item = order.items.find((i) => i.id === input.orderItemId);
  if (!item) return { ok: false, error: "Item not found on this order." };

  const existing = await prisma.refundRequest.findFirst({
    where: { orderItemId: item.id, status: { in: ["PENDING", "APPROVED"] } },
  });
  if (existing) {
    return { ok: false, error: "A return request is already in progress for this item." };
  }

  const methodError = validateRefundMethodForOrder(input.refundMethod, order.paymentMethod);
  if (methodError) return { ok: false, error: methodError };

  // v1: the item's full gross line value (subtotal + tax) — a whole-item
  // return only, no partial-quantity/partial-amount picking yet. Does NOT
  // yet split a partial-prepaid order's refund by collection channel (the
  // advance actually paid through the gateway vs. any remainder collected
  // as cash on delivery) — that's a real refinement ORIGINAL_SOURCE
  // refunds will eventually need (you can only gateway-refund what the
  // gateway actually collected), left as a follow-up once real Razorpay
  // payments exist to reason about.
  const amount = round2(Number(item.subtotal) + Number(item.taxAmount));

  const actor = { id: customerId, role: actorRole };
  const result = await prisma.$transaction(async (tx) => {
    const transition = await recordStatusChange(
      tx,
      order.id,
      order.status,
      "RETURN_REQUESTED",
      actor,
      // Matches cancellation.ts's requestCancellation: "CUSTOMER" covers
      // both a real customer and a dealer acting as the buyer here — it's
      // the coarser TransitionSource bucket, not the finer UserRole.
      "CUSTOMER",
      input.reason,
    );
    if (!transition.ok) return transition;

    await tx.refundRequest.create({
      data: {
        sellerOrderId: order.id,
        orderItemId: item.id,
        customerId,
        reason: input.reason,
        imageUrls: input.imageUrls,
        videoUrl: input.videoUrl,
        amount,
        refundMethod: input.refundMethod,
        bankAccountHolderName: input.bankAccountHolderName,
        bankAccountNumber: input.bankAccountNumber,
        bankIfsc: input.bankIfsc,
        history: {
          create: { status: "PENDING", changedById: customerId, changedByRole: actorRole },
        },
      },
    });
    return transition;
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: customerId,
      actorRole,
      action: "RETURN_REQUESTED",
      entityType: "SellerOrder",
      entityId: order.id,
      reason: input.reason,
    });
  }
  return result;
}

/**
 * Admin approves (→ RETURN_APPROVED, ready for completeRefund below) or
 * rejects (→ RETURN_REJECTED, terminal — see that status's own doc
 * comment in status-transitions.ts) a pending return request. Kept
 * admin-only, same as decideCancellation — a financial decision, not
 * delegated to seller.
 */
export async function decideReturnRequest(
  adminUserId: string,
  input: DecideReturnRequestInput,
): Promise<RefundResult> {
  const refundRequest = await prisma.refundRequest.findUnique({
    where: { id: input.refundRequestId },
    include: { sellerOrder: { select: { id: true, status: true, customerId: true, orderNumber: true } } },
  });
  if (!refundRequest) return { ok: false, error: "Refund request not found." };
  if (refundRequest.status !== "PENDING") {
    return { ok: false, error: "This refund request has already been reviewed." };
  }

  // orderItemId null => a whole-order cancellation refund
  // (cancellation.ts's settleMoneyForCancelledOrder). It sits on a
  // CANCELLED order and never moves the order's status; a per-item
  // post-delivery return sits on RETURN_REQUESTED and does.
  const isCancellationRefund = refundRequest.orderItemId === null;
  if (isCancellationRefund) {
    if (refundRequest.sellerOrder.status !== "CANCELLED") {
      return { ok: false, error: "This order isn't cancelled — nothing to approve a refund against." };
    }
    if (!input.approve) {
      return {
        ok: false,
        error:
          "A cancellation refund can't be rejected — the order is already cancelled and the customer paid for it. Approve it (edit the amount first if it's wrong).",
      };
    }
  } else if (refundRequest.sellerOrder.status !== "RETURN_REQUESTED") {
    return { ok: false, error: "This order's return request is no longer pending." };
  }
  // Enforced again here, not just in decideReturnRequestInputSchema's
  // superRefine — that only guards the Server Action boundary; this
  // function must not trust a caller that bypasses it, same discipline as
  // decidePosPaymentProof's own reason check.
  if (!input.approve && !input.note?.trim()) {
    return { ok: false, error: "A rejection reason is required." };
  }

  const actor = { id: adminUserId, role: "ADMIN" as UserRole };
  const targetOrderStatus: OrderStatus = input.approve ? "RETURN_APPROVED" : "RETURN_REJECTED";
  const targetRefundStatus: RefundStatus = input.approve ? "APPROVED" : "REJECTED";

  const result = await prisma.$transaction(async (tx) => {
    if (!isCancellationRefund) {
      const transition = await recordStatusChange(
        tx,
        refundRequest.sellerOrderId,
        refundRequest.sellerOrder.status,
        targetOrderStatus,
        actor,
        "ADMIN",
        input.note,
      );
      if (!transition.ok) return transition;
    }

    await tx.refundRequest.update({
      where: { id: refundRequest.id },
      data: { status: targetRefundStatus, reviewNote: input.note, reviewedById: adminUserId },
    });
    await tx.refundStatusHistory.create({
      data: {
        refundRequestId: refundRequest.id,
        status: targetRefundStatus,
        changedById: adminUserId,
        changedByRole: "ADMIN",
        message: input.note,
      },
    });
    return { ok: true as const };
  });

  let reversePickupWarning: string | undefined;
  let refundCompletionWarning: string | undefined;
  if (result.ok) {
    // An approved return reverses the sale — void this item's settlement so
    // it never pays out. Within the 48h window the row is still PENDING and
    // this drops it to REVERSED before it ever enters a payout cycle; done
    // outside the status transaction on purpose (an append-only settlement
    // adjustment, and a failure here must not undo the approval).
    if (input.approve && refundRequest.orderItemId) {
      const voidResult = await voidSettlementForReturnedItem(refundRequest.orderItemId, actor, {
        refundRequestId: refundRequest.id,
      });
      if (voidResult.pastWindow) {
        await writeAuditLog({
          actorId: adminUserId,
          actorRole: "ADMIN",
          action: "SETTLEMENT_ADJUSTMENT",
          entityType: "SellerOrder",
          entityId: refundRequest.sellerOrderId,
          reason: "Return approved after the settlement left the pending window — review the payout batch.",
        });
      }

      // Auto-book the reverse pickup with whichever courier delivered the
      // order — "return to sender." Best-effort: the return is already
      // approved; a courier failure just leaves reversePickupWarning for
      // the admin to retry from the order page. MOCK / no-shipment orders
      // stay a manual arrangement, by design. Dynamic import to keep this
      // module out of the courier-shipping dependency cycle
      // (delhivery-shipping -> order-workflow -> cancellation -> refunds).
      const shipment = await prisma.shipment.findUnique({
        where: { sellerOrderId: refundRequest.sellerOrderId },
        select: { provider: true, returnShipmentId: true, returnRapidshypOrderId: true },
      });
      const alreadyScheduled = !!(shipment?.returnShipmentId || shipment?.returnRapidshypOrderId);
      if (shipment && !alreadyScheduled) {
        if (shipment.provider === "RAPIDSHYP") {
          const { sendReturnToRapidShyp } = await import("./rapidshyp-return");
          const r = await sendReturnToRapidShyp(actor, { refundRequestId: refundRequest.id });
          if (!r.ok) reversePickupWarning = `RapidShyp reverse pickup: ${r.error}`;
        } else if (shipment.provider === "DELHIVERY") {
          const { sendReturnToDelhivery } = await import("./delhivery-shipping");
          const r = await sendReturnToDelhivery(actor, { refundRequestId: refundRequest.id });
          if (!r.ok) reversePickupWarning = `Delhivery reverse pickup: ${r.error}`;
        }
      }
    }

    // Approval is the human gate — once given, actually move the money.
    // completeRefund credits the wallet / fires the Razorpay refund. A
    // gateway failure (or a BANK_TRANSFER that needs a manual reference)
    // leaves the request APPROVED for the "Complete refund" fallback and
    // surfaces a warning.
    if (input.approve) {
      try {
        const done = await completeRefund(actor, { refundRequestId: refundRequest.id });
        if (!done.ok) refundCompletionWarning = done.error;
      } catch (err) {
        refundCompletionWarning = err instanceof Error ? err.message : "payout call failed";
      }
    }

    await writeAuditLog({
      actorId: adminUserId,
      actorRole: "ADMIN",
      action: isCancellationRefund
        ? input.approve
          ? "CANCELLATION_REFUND_APPROVED"
          : "CANCELLATION_REFUND_REJECTED"
        : input.approve
          ? "RETURN_APPROVED"
          : "RETURN_REJECTED",
      entityType: "SellerOrder",
      entityId: refundRequest.sellerOrderId,
      reason: input.note,
    });
    await notifyBuyer({
      customerId: refundRequest.sellerOrder.customerId,
      title: input.approve ? "Refund approved" : "Refund request rejected",
      body: input.approve
        ? `Your refund for order ${refundRequest.sellerOrder.orderNumber} was approved and is being processed.`
        : `Your refund request for order ${refundRequest.sellerOrder.orderNumber} was rejected.${input.note ? ` Reason: ${input.note}` : ""}`,
    });
  }

  if (result.ok && (reversePickupWarning || refundCompletionWarning)) {
    const parts: string[] = [];
    if (refundCompletionWarning)
      parts.push(`the refund couldn't be sent automatically (${refundCompletionWarning}) — use "Complete refund"`);
    if (reversePickupWarning)
      parts.push(`the courier return pickup couldn't be booked (${reversePickupWarning}) — retry from the order page`);
    return { ok: true, warning: `Approved, but ${parts.join("; and ")}.` };
  }
  return result;
}

/**
 * Completes an approved return's refund — branches on the RefundRequest's
 * own refundMethod, chosen by the customer at request time:
 *
 * - WALLET: fully automated — credits Wallet.balance via the existing
 *   refundWalletAmount ledger function (packages/orders/src/wallet.ts),
 *   the same one cancellation.ts already uses for a wallet-funded-amount
 *   reversal.
 * - ORIGINAL_SOURCE: automated when this order's payment actually went
 *   through real Razorpay (Payment.razorpayPaymentId set — see
 *   checkout.ts's completePaymentFromRazorpay) — calls the Razorpay
 *   Refunds API and uses the resulting refund id as externalReference.
 *   Falls back to requiring a human-entered externalReference for an
 *   order paid before this integration existed (mock provider era).
 * - BANK_TRANSFER: NOT automated — no payout provider (RazorpayX Payouts)
 *   is integrated yet. Requires a human-entered externalReference (a real
 *   payout id once that lands, or a manual bank-transfer reference for a
 *   transfer done outside the system today) as proof the money actually
 *   moved — never silently marks REFUND_COMPLETED without one.
 *
 * Both RETURN_APPROVED -> REFUND_INITIATED -> REFUND_COMPLETED happen in
 * this one call — nothing today needs REFUND_INITIATED to be independently
 * visible/actionable (no async gateway callback exists yet to land in that
 * gap), same "hide the intermediate hop behind one click" reasoning as
 * order-workflow.ts's markPackedCore.
 */
export async function completeRefund(
  actor: { id: string; role: UserRole },
  input: CompleteRefundInput,
): Promise<RefundResult> {
  const refundRequest = await prisma.refundRequest.findUnique({
    where: { id: input.refundRequestId },
    include: { sellerOrder: { select: { id: true, status: true, customerId: true, orderNumber: true } } },
  });
  if (!refundRequest) return { ok: false, error: "Return request not found." };
  if (refundRequest.status !== "APPROVED") {
    return { ok: false, error: "Only an approved return request can be completed." };
  }
  // A whole-order refund (orderItemId null) sits on either a CANCELLED
  // order (cancellation.ts's decideCancellation) or an RTO'd order
  // (settleMoneyForRtoOrder above) — neither has any further outgoing
  // OrderStatus transitions from RTO_DELIVERED_TO_SELLER/CANCELLED
  // (status-transitions.ts), and RTO_INITIATED's only forward transition is
  // to RTO_DELIVERED_TO_SELLER, so either RTO status is a valid "ready to
  // refund" state. The item-level post-delivery flow still requires
  // RETURN_APPROVED, same as before.
  const isCancellationRefund = refundRequest.orderItemId === null;
  const WHOLE_ORDER_REFUND_READY_STATUSES: OrderStatus[] = [
    "CANCELLED",
    "RTO_INITIATED",
    "RTO_DELIVERED_TO_SELLER",
  ];
  if (isCancellationRefund) {
    if (!WHOLE_ORDER_REFUND_READY_STATUSES.includes(refundRequest.sellerOrder.status)) {
      return { ok: false, error: "This order isn't ready to complete a refund." };
    }
  } else if (refundRequest.sellerOrder.status !== "RETURN_APPROVED") {
    return { ok: false, error: "This order isn't ready to complete a refund." };
  }

  // A POS order's refund is left for its operator to decide at completion
  // time (see autoCompleteCancellationRefund's doc comment) rather than
  // being locked to whatever refundMethod the request happened to be
  // created with — validated the same way a customer's own choice is, so
  // an override can never ask for a method the order's paymentMethod
  // doesn't support (e.g. ORIGINAL_SOURCE on a pure-COD order).
  let refundMethod: RefundMethod = refundRequest.refundMethod;
  if (input.overrideRefundMethod && input.overrideRefundMethod !== refundMethod) {
    // Only a method refundChoicesFor offers for this order — e.g. never
    // anything but the buyer's own choice when they made one.
    const ctx = await loadRefundChoiceContext(refundRequest);
    if (!ctx) return { ok: false, error: "Order not found." };
    if (!refundChoicesFor(ctx).some((c) => c.method === input.overrideRefundMethod)) {
      return { ok: false, error: "That refund method isn't available for this order." };
    }
    const methodError = validateRefundMethodForOrder(input.overrideRefundMethod, ctx.paymentMethod);
    if (methodError) return { ok: false, error: methodError };
    refundMethod = input.overrideRefundMethod;
  }

  let externalReference = input.externalReference?.trim() || undefined;

  // A cancellation refund's `amount` is the WHOLE refundable sum — the
  // wallet-funded slice plus any gateway/COD money. Split it by the channel
  // it came from: the wallet-funded part always returns to the wallet; only
  // the rest goes by the customer's chosen refundMethod (so an
  // ORIGINAL_SOURCE refund never asks Razorpay for more than it actually
  // captured). A per-item return refund isn't split — its whole amount is
  // the "source" part (partial-prepaid channel splitting for returns is a
  // documented follow-up).
  let walletBackAmount = 0;
  let sourceBackAmount = Number(refundRequest.amount);
  if (isCancellationRefund) {
    const allocs = await prisma.paymentAllocation.findMany({
      where: { sellerOrderId: refundRequest.sellerOrderId },
      select: { walletAmountApplied: true, walletRefunded: true },
    });
    walletBackAmount = round2(
      allocs.reduce((sum, a) => sum + (a.walletRefunded ? 0 : Number(a.walletAmountApplied)), 0),
    );
    sourceBackAmount = round2(Math.max(0, Number(refundRequest.amount) - walletBackAmount));
  }

  // ORIGINAL_SOURCE is automated when this order's payment actually went
  // through real Razorpay (razorpayPaymentId set — see checkout.ts's
  // completePaymentFromRazorpay) — refunds straight back to whatever
  // card/UPI/netbanking source paid it, no manual reference needed. Falls
  // back to requiring one for an order paid before this integration
  // existed (mock/mid-migration), same as BANK_TRANSFER always does
  // (RazorpayX Payouts isn't wired in).
  if (refundMethod === "ORIGINAL_SOURCE" && !externalReference && sourceBackAmount > 0.01) {
    const allocation = await prisma.paymentAllocation.findFirst({
      where: { sellerOrderId: refundRequest.sellerOrderId },
      include: { payment: { select: { razorpayPaymentId: true } } },
    });
    const razorpayPaymentId = allocation?.payment.razorpayPaymentId;
    if (razorpayPaymentId) {
      const refund = await razorpayCreateRefund({
        paymentId: razorpayPaymentId,
        amountRupees: sourceBackAmount,
        notes: { refundRequestId: refundRequest.id, orderNumber: refundRequest.sellerOrder.orderNumber },
      });
      if (!refund.ok) return { ok: false, error: `Razorpay: ${refund.error}` };
      externalReference = refund.data.id;
    }
  }

  if (refundMethod !== "WALLET" && sourceBackAmount > 0.01 && !externalReference) {
    return {
      ok: false,
      error:
        "Enter the gateway refund ID / payout reference (or a manual transfer reference — automatic RazorpayX payouts aren't wired in yet) to mark this completed.",
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    if (!isCancellationRefund) {
      const initiate = await recordStatusChange(
        tx,
        refundRequest.sellerOrderId,
        "RETURN_APPROVED",
        "REFUND_INITIATED",
        actor,
        "ADMIN",
        "Refund initiated",
      );
      if (!initiate.ok) return initiate;
      const complete = await recordStatusChange(
        tx,
        refundRequest.sellerOrderId,
        "REFUND_INITIATED",
        "REFUND_COMPLETED",
        actor,
        "ADMIN",
        "Refund completed",
      );
      if (!complete.ok) return complete;
    }
    // A cancellation refund leaves SellerOrder.status at CANCELLED
    // throughout — that already fully describes the order's terminal
    // state; RefundRequest.status (updated below) is what tracks whether
    // the money side is actually done.

    // Wallet-funded slice back to the wallet (cancellation only), and mark
    // the allocations so a re-run can't double-credit.
    if (isCancellationRefund && walletBackAmount > 0.01) {
      await refundWalletAmount(tx, {
        userId: refundRequest.customerId,
        amount: walletBackAmount,
        referenceId: refundRequest.id,
      });
      await tx.paymentAllocation.updateMany({
        where: {
          sellerOrderId: refundRequest.sellerOrderId,
          walletAmountApplied: { gt: 0 },
          walletRefunded: false,
        },
        data: { walletRefunded: true },
      });
    }

    // The rest, by the chosen method. WALLET credits it too; ORIGINAL_SOURCE
    // / BANK_TRANSFER moved it outside this transaction (Razorpay call above
    // / a manual transfer), recorded via externalReference.
    if (refundMethod === "WALLET" && sourceBackAmount > 0.01) {
      await refundWalletAmount(tx, {
        userId: refundRequest.customerId,
        amount: sourceBackAmount,
        referenceId: refundRequest.id,
      });
    }
    if (refundRequest.orderItemId) {
      // Dealer-only, a no-op for a customer order — see loyalty-points.ts.
      // Never applies to a cancellation refund: loyalty is only ever
      // awarded at DELIVERED (order-workflow.ts), and cancellation is
      // always pre-delivery, so there's nothing to reverse.
      await reverseLoyaltyPointsForOrderItem(tx, refundRequest.orderItemId);
    }

    await tx.refundRequest.update({
      where: { id: refundRequest.id },
      data: {
        status: "REFUNDED",
        refundMethod,
        externalReference: externalReference ?? null,
        completedAt: new Date(),
      },
    });
    await tx.refundStatusHistory.create({
      data: {
        refundRequestId: refundRequest.id,
        status: "REFUNDED",
        changedById: actor.id,
        changedByRole: actor.role,
        message: externalReference,
      },
    });
    return { ok: true as const };
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "REFUND_COMPLETED",
      entityType: "SellerOrder",
      entityId: refundRequest.sellerOrderId,
      metadata: { refundMethod, amount: Number(refundRequest.amount) },
      reason: externalReference,
    });
    await notifyBuyer({
      customerId: refundRequest.sellerOrder.customerId,
      title: "Refund completed",
      body: `Your refund of ₹${refundRequest.amount} for order ${refundRequest.sellerOrder.orderNumber} has been completed.`,
    });
  }
  return result;
}

export type CancellationRefundOutcome = {
  /** false when the cancelled order had nothing to refund (unpaid COD / free order) — nothing was created, nothing to report. */
  attempted: boolean;
  amount: number;
  /** true once the money has actually moved (wallet credited and/or Razorpay refund issued). */
  completed: boolean;
  /** Set when `completed` is false — the request is left APPROVED for an admin to finish from the refund panel's "Complete refund" action. */
  warning?: string;
};

/**
 * Auto-settles the order-level RefundRequest settleMoneyForCancelledOrder
 * just created (cancellation.ts) — called once that function's own
 * transaction has committed, since it (like completeRefund) opens its own
 * queries/transaction and would otherwise race the still-uncommitted insert.
 *
 * A cancellation doesn't need the extra human "review this refund" gate a
 * post-delivery return does — the cancellation itself (an admin decision,
 * or the buyer's own still-pending self-cancel) already authorized giving
 * the money back. This skips straight to APPROVED and calls completeRefund,
 * whose existing branching does the right thing per channel: the
 * wallet-funded slice always credits back immediately; a slice actually
 * paid through Razorpay (Payment.razorpayPaymentId set) auto-refunds
 * through the gateway; a POS/COD/no-gateway slice has no automated source
 * to push money back through, so completeRefund fails asking for a manual
 * reference and the request is left APPROVED for "Complete refund" —
 * never silently marked done for money that didn't actually move.
 */
export async function autoCompleteCancellationRefund(
  sellerOrderId: string,
  actor: { id: string; role: UserRole },
): Promise<CancellationRefundOutcome> {
  const refundRequest = await prisma.refundRequest.findFirst({
    where: { sellerOrderId, orderItemId: null, status: "PENDING" },
  });
  if (!refundRequest) return { attempted: false, amount: 0, completed: false };

  const amount = round2(Number(refundRequest.amount));

  await prisma.$transaction(async (tx) => {
    await tx.refundRequest.update({
      where: { id: refundRequest.id },
      data: { status: "APPROVED", reviewedById: actor.id },
    });
    await tx.refundStatusHistory.create({
      data: {
        refundRequestId: refundRequest.id,
        status: "APPROVED",
        changedById: actor.id,
        changedByRole: actor.role,
        message: "Auto-approved on cancellation — the cancellation itself is the review.",
      },
    });
  });

  // When the admin has a real choice to make (refundChoicesFor offers more
  // than one method) the refund is left APPROVED rather than silently
  // defaulted to the wallet: a POS order (manual vs wallet — money taken in
  // person has no gateway to push back through), or a Razorpay-paid order
  // nobody picked a method for (an admin cancel or a courier RTO: wallet vs
  // Razorpay). The refund dropdown on the orders tables / order page
  // completes it. A buyer's own choice, or a wallet-only refund, still
  // completes immediately.
  const choiceContext = await loadRefundChoiceContext(refundRequest);
  if (choiceContext && refundChoicesFor(choiceContext).length > 1) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "CANCELLATION_REFUND_APPROVED",
      entityType: "SellerOrder",
      entityId: sellerOrderId,
      reason: "Approved — awaiting the admin's refund method choice",
    });
    return { attempted: true, amount, completed: false };
  }

  let warning: string | undefined;
  try {
    const done = await completeRefund(actor, { refundRequestId: refundRequest.id });
    if (!done.ok) warning = done.error;
  } catch (err) {
    warning = err instanceof Error ? err.message : "The refund could not be completed automatically.";
  }

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: "CANCELLATION_REFUND_APPROVED",
    entityType: "SellerOrder",
    entityId: sellerOrderId,
    reason: warning ? `Auto-refund incomplete: ${warning}` : "Auto-refunded on cancellation",
  });

  return { attempted: true, amount, completed: !warning, warning };
}

type OrderWithPaymentAllocationsForRto = Prisma.SellerOrderGetPayload<{
  include: { paymentAllocations: { include: { payment: true } } };
}>;

/**
 * Money side of an RTO'd order — the courier's own delivery attempt failed
 * and the shipment is on its way back to the seller, so nothing further can
 * be collected on delivery; whatever the buyer already paid (wallet and/or
 * gateway/POS) needs to go back. Mirrors cancellation.ts's
 * settleMoneyForCancelledOrder exactly (same PENDING, whole-order,
 * orderItemId-null RefundRequest shape, same downstream completeRefund
 * split-by-channel), just for a different trigger and reason text — RTO had
 * no refund handling at all before this (order-workflow.ts's RTO_INITIATED
 * transition never created one). Must be called from inside a
 * `prisma.$transaction`, same as its cancellation counterpart.
 */
export async function settleMoneyForRtoOrder(
  tx: Prisma.TransactionClient,
  order: OrderWithPaymentAllocationsForRto,
  actor: { id: string; role: UserRole },
): Promise<void> {
  const totalRefundable = paidSoFarFor(order.paymentAllocations);
  if (totalRefundable <= 0.01) return;

  const refundRequest = await tx.refundRequest.create({
    data: {
      sellerOrderId: order.id,
      orderItemId: null,
      customerId: order.customerId,
      status: "PENDING",
      reason: "Order returned to origin (RTO) — refund of amount already paid",
      imageUrls: [],
      amount: round2(totalRefundable),
      refundMethod: "WALLET",
    },
  });
  await tx.refundStatusHistory.create({
    data: {
      refundRequestId: refundRequest.id,
      status: "PENDING",
      changedById: actor.id,
      changedByRole: actor.role,
      message: "Auto-created on RTO — awaiting refund approval",
    },
  });
}
