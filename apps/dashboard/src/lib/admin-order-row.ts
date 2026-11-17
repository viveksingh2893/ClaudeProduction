import {
  canTransition,
  isLogisticsStatusLocked,
  LOGISTICS_LIFECYCLE_STATUSES,
  netPayableForOrder,
  paidSoFarFor,
  selectLivePaymentProofSubmissions,
  isPaymentProofFullyApproved,
  requiredPaymentProofAmount,
  refundChoicesFor,
  type listSellerOrdersForAdmin,
} from "@kisan4u/orders";
import { getFullName, type OrderStatus } from "@kisan4u/db";
import { posPaymentProofStatusLabel } from "./pos-payment-proof-status";
import { buildOrderAmountEquation } from "./order-amount-equation";
import { ORDER_STATUS_LABEL } from "./order-status-labels";
import type { OrderRow } from "@/app/admin/orders/orders-table";

type AdminOrder = Awaited<ReturnType<typeof listSellerOrdersForAdmin>>["rows"][number];

const ALL_STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];
const PENDING_STATUSES = new Set(["PENDING_PAYMENT", "PAYMENT_PARTIALLY_RECEIVED"]);
// Mirrors REVERTIBLE_STATUSES in @kisan4u/orders' revertConfirmedOrderToPending.
const REVERTIBLE_STATUSES = new Set(["CONFIRMED", "SELLER_ACCEPTED", "PACKED"]);
const LOGISTICS_LIFECYCLE_SET = new Set<string>(LOGISTICS_LIFECYCLE_STATUSES);
// Where completeRefund accepts an APPROVED refund (see refunds.ts).
const REFUND_READY_KIND: Partial<Record<string, "Cancellation" | "Return" | "RTO">> = {
  CANCELLED: "Cancellation",
  RTO_INITIATED: "RTO",
  RTO_DELIVERED_TO_SELLER: "RTO",
  RETURN_APPROVED: "Return",
};

/**
 * The valid next statuses an ADMIN can move this order to from the table's
 * inline control — every canTransition target, minus:
 *  - CONFIRMED/CANCELLED for a still-Pending order (those go through the
 *    dedicated Confirm / Cancel flow, which deducts stock / refunds; the
 *    generic override does neither), and
 *  - the whole fulfilment pipeline (accept → … → delivered) once the order
 *    is either not yet dispatched or is with a real courier — those move
 *    only via Create Shipment and the partner's own tracking
 *    (isLogisticsStatusLocked). Mock / TRANSPORT orders keep the manual
 *    pipeline. Mirrors transitionSellerOrder's server guard — the server
 *    stays the authority; this just hides options that would be rejected.
 */
function nextStatusesForAdmin(
  current: string,
  logistics: { deliveryMethod: string; shipmentProvider: string | null },
): { value: string; label: string }[] {
  const isPending = PENDING_STATUSES.has(current);
  const pipelineLocked = isLogisticsStatusLocked({
    deliveryMethod: logistics.deliveryMethod,
    shipmentProvider: logistics.shipmentProvider,
  });
  return ALL_STATUSES.filter((s) => {
    if (!canTransition(current as OrderStatus, s, "ADMIN")) return false;
    if (isPending && (s === "CONFIRMED" || s === "CANCELLED")) return false;
    if (pipelineLocked && LOGISTICS_LIFECYCLE_SET.has(s)) return false;
    // PENDING_PAYMENT is reachable only through the dedicated "Revert to
    // pending" control (revertOrderToPendingAction / canRevertToPending
    // below) — that path restores the stock confirmOrder deducted, in the
    // same transaction as the status change. This generic override does
    // NOT (see stock.ts's own doc comment), so surfacing it here would
    // silently corrupt inventory on a later re-confirm (double deduction).
    if (s === "PENDING_PAYMENT") return false;
    return true;
  }).map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] ?? s }));
}

/**
 * Shared between the full admin orders table (/admin/orders) and the
 * restricted "Payment Verifier" role's table (/admin/payment-verification)
 * — both show the exact same order list and amount-equation math, so this
 * lives in one place rather than being copy-pasted per page.
 */
export function buildAdminOrderRow(
  order: AdminOrder,
  imageByItemId: Map<string, string | null>,
): OrderRow {
  const netPayable = netPayableForOrder(order);
  const discountAmount = order.charge ? Number(order.charge.promotionalDiscountAmount) : 0;
  const paidSoFar = paidSoFarFor(order.paymentAllocations);
  const balanceRemaining = Math.max(0, netPayable - paidSoFar);
  const equation = buildOrderAmountEquation({
    paymentMethod: order.paymentMethod,
    netPayable,
    discountAmount,
    customerType: order.customerType,
    allocation: order.paymentAllocations[0] ?? null,
  });
  // decideProposedOrder (BA approval flow, packages/orders/src/ba/
  // proposed-order.ts) reuses the exact same checkout()-level placedBy
  // mechanism POS uses — placedByUserId != null alone can't tell a real
  // POS order (placed by a dashboard STAFF member) apart from a
  // BA-approved order (placed by the BA's own customer/dealer account).
  // Distinguish by what kind of profile placedByUserId actually resolves
  // to (see listSellerOrdersForAdmin's placedByUser include).
  const baProfile = order.checkoutGroup.placedByUser?.baProfile ?? null;
  const isPosOrder = order.placedByUserId != null && order.checkoutGroup.placedByUser?.staffProfile != null;
  const isBaOrder = order.placedByUserId != null && baProfile != null;
  const liveSubmissions = selectLivePaymentProofSubmissions(order.checkoutGroup.paymentProofSubmissions);
  const proofPayment = order.paymentAllocations[0]?.payment ?? null;
  const requiredProofAmount = proofPayment ? requiredPaymentProofAmount(proofPayment) : 0;
  const proofAmountShort =
    liveSubmissions.length > 0 &&
    liveSubmissions.every((s) => s.status === "APPROVED") &&
    !isPaymentProofFullyApproved(liveSubmissions, requiredProofAmount);
  const proof = posPaymentProofStatusLabel({
    isPosOrder,
    paymentMethod: order.paymentMethod,
    liveSubmissions: liveSubmissions.map((s) => ({ status: s.status })),
    amountShort: proofAmountShort,
  });
  // A POS non-COD order (partial OR full prepaid — the payment-proof
  // screenshot flow only exists for POS) with at least one screenshot
  // uploaded but not every one of them APPROVED yet (a buyer paying in
  // instalments may have several), or approved but not yet summing to the
  // required remaining (post-wallet) amount. The order can't be confirmed
  // / move forward until that's fully covered, so the Payment column says
  // so instead of just "Pending".
  const screenshotNotApproved =
    isPosOrder &&
    order.paymentMethod !== "COD" &&
    liveSubmissions.length > 0 &&
    !isPaymentProofFullyApproved(liveSubmissions, requiredProofAmount);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    checkoutGroupNumber: order.checkoutGroup.groupNumber,
    createdAt: order.createdAt,
    customer: {
      name: getFullName(order.customer) ?? order.customer.phone ?? "—",
      phone: order.customer.phone,
    },
    // Prefer the BA's real name over the placedByName snapshot (older BA
    // orders stored the literal "Business Associate" there — see
    // decideProposedOrder's doc comment).
    placedBy: isBaOrder && baProfile ? `${baProfile.firstName} ${baProfile.lastName}`.trim() : order.placedByName,
    placedByKind: isBaOrder ? "BA" : isPosOrder ? "POS" : null,
    seller: { shopName: order.seller.shopName },
    deliveryMethod: order.deliveryMethod,
    status: order.status,
    paymentMethod: order.paymentMethod,
    totalAmount: netPayable.toFixed(2),
    paidSoFar: paidSoFar.toFixed(2),
    balanceRemaining: balanceRemaining.toFixed(2),
    amountEquation: {
      prepaidAmount: equation.prepaidAmount.toFixed(2),
      codAmount: equation.codAmount.toFixed(2),
      walletAmount: equation.walletAmount.toFixed(2),
      finalAmount: equation.finalAmount.toFixed(2),
      discountNote: equation.discountNote != null ? equation.discountNote.toFixed(2) : null,
    },
    proofStatus: proof,
    screenshotNotApproved,
    paymentAllocations: order.paymentAllocations.map((pa) => ({
      payment: { status: pa.payment.status },
    })),
    firstItem: order.items[0]
      ? {
          name: order.items[0].productName,
          imageUrl: imageByItemId.get(order.items[0].id) ?? null,
        }
      : null,
    itemCount: order.items.length,
    nextStatuses: nextStatusesForAdmin(order.status, {
      deliveryMethod: order.deliveryMethod,
      shipmentProvider: order.shipment?.provider ?? null,
    }),
    canConfirm: PENDING_STATUSES.has(order.status),
    canRevertToPending: REVERTIBLE_STATUSES.has(order.status) && !order.shipment,
    labelUrl: order.shipment?.labelUrl ?? null,
    remarkCount: order._count?.notes ?? 0,
    refund: buildRefundCell(order, isPosOrder),
  };
}

function buildRefundCell(order: AdminOrder, isPosOrder: boolean): OrderRow["refund"] {
  const kind = REFUND_READY_KIND[order.status];
  const refundRequest = order.refundRequests[0];
  if (!kind || !refundRequest) return null;
  return {
    refundRequestId: refundRequest.id,
    kind,
    amount: Number(refundRequest.amount).toFixed(2),
    choices: refundChoicesFor({
      isPos: isPosOrder,
      buyerChoice: refundRequest.orderItemId ? refundRequest.refundMethod : order.cancellationRefundMethod,
      paymentMethod: order.paymentMethod,
      hasGatewayPayment: order.paymentAllocations.some((pa) => pa.payment.razorpayPaymentId != null),
    }),
  };
}
