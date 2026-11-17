"use server";

import { revalidatePath } from "next/cache";
import {
  transitionSellerOrder,
  decideCancellation,
  confirmOrder,
  cancelPendingOrder,
  revertConfirmedOrderToPending,
  adminMarkInTransit,
  adminMarkDelivered,
  adminMarkDeliveryFailed,
  recordPaymentCollected,
  decidePosPaymentProof,
  sendSellerOrderToRapidShyp,
  packAndSendToRapidShyp,
  packAndSendToDelhivery,
  packAndScheduleMockPickup,
  refreshRapidShypTrackingStatus,
  refreshDelhiveryTrackingStatus,
  acceptOrderAsAdmin,
  decideReturnRequest,
  completeRefund,
  sendReturnToRapidShyp,
  sendReturnToDelhivery,
  dispatchOrderViaWizard,
  getSellerOrderForAdmin,
  getSelectablePickupPoints,
  getOrderAddressForAdmin,
  updateOrderAddress,
  addOrderNote,
  listOrderNotes,
  listSellerOrdersForAdmin,
  resolveOrderItemImageUrls,
} from "@kisan4u/orders";
import { prisma, getFullName } from "@kisan4u/db";
import {
  adminManualStatusUpdateInputSchema,
  adminCancellationDecisionInputSchema,
  recordPaymentCollectedInputSchema,
  posPaymentProofDecisionSchema,
  sendToRapidShypInputSchema,
  sendToDelhiveryInputSchema,
  acceptOrderInputSchema,
  decideReturnRequestInputSchema,
  completeRefundInputSchema,
  sendReturnToRapidShypInputSchema,
  dispatchViaWizardInputSchema,
  orderAddressUpdateInputSchema,
} from "@kisan4u/validators";
import type { OrderStatus } from "@kisan4u/db";
import { requireAdminPermission } from "@/lib/session-guard";
import { PAYMENT_VERIFICATION_MODULE_KEY } from "@/lib/payment-verification-guard";
import { requireOrdersSectionEdit, requireOrdersSectionView } from "@/lib/order-scheduling-guard";
import { resolveStorefrontAssetUrl } from "@/lib/storefront-url";

type Result = { ok: true } | { ok: false; error: string };

/** Only a transition already allowed for ADMIN in the central transition map (@kisan4u/orders' status-transitions.ts) actually succeeds — this action cannot bypass it (Phase 4 spec §S — "manual mock status update through valid transitions only"). */
export async function adminManualStatusUpdateAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = adminManualStatusUpdateInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await transitionSellerOrder(
    parsed.data.sellerOrderId,
    parsed.data.targetStatus as OrderStatus,
    { id: session.user.id, role: "ADMIN" },
    "ADMIN",
    parsed.data.note,
  );
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

/**
 * The Kisan4U scheduling team's confirmation gate. Every order is placed as
 * "Pending" regardless of payer or payment method; the team calls the
 * customer, then an admin confirms here (→ CONFIRMED, stock deducted, the
 * order becomes visible to the seller) or cancels (→ CANCELLED, any
 * captured advance/prepaid amount refunded). See @kisan4u/orders'
 * confirmOrder / cancelPendingOrder.
 */
export async function confirmOrderAction(sellerOrderId: string, note?: string): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  if (typeof sellerOrderId !== "string" || !sellerOrderId) {
    return { ok: false, error: "Invalid order." };
  }
  const result = await confirmOrder(session.user.id, sellerOrderId, note?.trim() || undefined);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

export async function cancelPendingOrderAction(
  sellerOrderId: string,
  reason: string,
): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  if (typeof sellerOrderId !== "string" || !sellerOrderId) {
    return { ok: false, error: "Invalid order." };
  }
  if (typeof reason !== "string" || reason.trim().length < 3) {
    return { ok: false, error: "Enter a reason for cancelling the order." };
  }
  const result = await cancelPendingOrder(session.user.id, sellerOrderId, reason.trim());
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

/**
 * The "couldn't schedule it" escape hatch for an order stuck between
 * Confirm and dispatch — see @kisan4u/orders' revertConfirmedOrderToPending
 * for the stock-restoration detail.
 */
export async function revertOrderToPendingAction(
  sellerOrderId: string,
  note?: string,
): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  if (typeof sellerOrderId !== "string" || !sellerOrderId) {
    return { ok: false, error: "Invalid order." };
  }
  const result = await revertConfirmedOrderToPending(session.user.id, sellerOrderId, note);
  if (result.ok) {
    revalidatePath(`/admin/orders/${sellerOrderId}`);
    revalidatePath("/admin/orders");
  }
  return result;
}

/** The Create Shipment wizard's pickup-warehouse list — this order's seller's approved, active pickup points. */
export async function adminLoadOrderPickupPointsAction(sellerOrderId: string) {
  await requireOrdersSectionEdit();
  const order = await getSellerOrderForAdmin(sellerOrderId);
  if (!order) return [];
  return getSelectablePickupPoints(order.sellerId);
}

/** The Create Shipment wizard's one action — accept + pack + schedule via the chosen partner. */
export async function adminDispatchViaWizardAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = dispatchViaWizardInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await dispatchOrderViaWizard({ id: session.user.id, role: "ADMIN" }, parsed.data);
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

/** The Create Shipment wizard's delivery-address section — loads the customer/dealer's address so a wrong one can be caught and corrected before dispatch. */
export async function adminLoadOrderAddressAction(sellerOrderId: string) {
  await requireOrdersSectionEdit();
  return getOrderAddressForAdmin(sellerOrderId);
}

/** Corrects a placed order's delivery address (see @kisan4u/orders' updateOrderAddress doc comment — this updates the whole checkout group, not just one seller's order within it). */
export async function adminUpdateOrderAddressAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = orderAddressUpdateInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await updateOrderAddress({ id: session.user.id, role: "ADMIN" }, parsed.data);
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

export async function adminCancellationDecisionAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = adminCancellationDecisionInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await decideCancellation(session.user.id, parsed.data);
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

/**
 * Dedicated logistics-status actions — a stand-in for the real
 * delivery-partner API/webhook that doesn't exist yet (see
 * order-workflow.ts's adminMark* doc comments). Unlike
 * adminManualStatusUpdateAction above, these keep Shipment/
 * ShipmentStatusHistory in sync with SellerOrder.status, exactly like the
 * seller's own equivalent actions do.
 */
export async function adminMarkInTransitAction(sellerOrderId: string): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const result = await adminMarkInTransit(session.user.id, sellerOrderId);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

export async function adminMarkDeliveredAction(sellerOrderId: string): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const result = await adminMarkDelivered(session.user.id, sellerOrderId);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

export async function adminMarkDeliveryFailedAction(
  sellerOrderId: string,
  reason: string,
): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const result = await adminMarkDeliveryFailed(session.user.id, sellerOrderId, reason);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

/**
 * Records cash (COD) or a deferred online balance (ONLINE_PARTIAL) as
 * collected for this seller order — see packages/orders/src/payment-collection.ts.
 * `collectedAmount` omitted collects the full outstanding balance; the
 * admin order detail page's amount field defaults to that but lets the
 * admin enter less for a genuine shortfall. A no-op-with-nothing-to-do
 * result (`ok:true`) is possible if payment was already completed
 * elsewhere (e.g. by the auto-complete-on-delivery hook) between page
 * load and this click — never an error in that case.
 */
export async function recordPaymentCollectedAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = recordPaymentCollectedInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await recordPaymentCollected(
    parsed.data.sellerOrderId,
    { id: session.user.id, role: "ADMIN" },
    parsed.data.collectedAmount,
  );
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Review of ONE POS payment-proof screenshot ("slot" — a buyer paying in
 * instalments has several concurrent live slots per checkout group, see
 * packages/orders/src/pos-payment-proof.ts). Reachable by a plain ADMIN
 * session (Super Admin is granted every module) or a STAFF session
 * holding the "Payment Verifier" role's payment-verification:EDIT
 * permission — that role can do nothing else (see
 * apps/dashboard/src/app/admin/payment-verification). `revalidate` is
 * only used here to refresh the page(s) being looked at; the decision
 * itself acts on just the one submissionId (every OTHER slot for the
 * checkout group, if any, is untouched).
 */
export async function decidePosPaymentProofAction(
  rawInput: unknown,
  revalidate: { checkoutGroupId: string; sellerOrderId?: string },
): Promise<Result> {
  const session = await requireAdminPermission(PAYMENT_VERIFICATION_MODULE_KEY, "EDIT");
  const parsed = posPaymentProofDecisionSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await decidePosPaymentProof(
    parsed.data.submissionId,
    { action: parsed.data.action, reason: parsed.data.reason || undefined },
    { id: session.user.id, role: session.user.role },
  );
  if (result.ok) {
    if (revalidate.sellerOrderId) revalidatePath(`/admin/orders/${revalidate.sellerOrderId}`);
    revalidatePath(`/admin/payment-verification/${revalidate.checkoutGroupId}`);
    revalidatePath("/admin/payment-verification");
    revalidatePath(`/admin/pos/orders/${revalidate.checkoutGroupId}`);
    revalidatePath("/admin/pos/orders");
  }
  return result;
}

/**
 * Admin-only: pushes a PACKED order to RapidShyp (real courier, not the
 * mock provider) and, on success, moves the order to PICKUP_SCHEDULED —
 * see packages/orders/src/rapidshyp-shipping.ts. Kept for the
 * PACKED-recovery case; the normal path from SELLER_ACCEPTED is
 * packAndSendToRapidShypAction below, which packs first automatically.
 */
export async function sendToRapidShypAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = sendToRapidShypInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await sendSellerOrderToRapidShyp(
    { id: session.user.id, role: "ADMIN" },
    parsed.data,
  );
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

/**
 * Admin equivalent of the seller's packAndSendToRapidShypAction — the
 * explicit "send to RapidShyp" choice from SELLER_ACCEPTED, unscoped
 * (works on any seller's order). Packs the order first if needed, then
 * dispatches, as one click.
 */
export async function packAndSendToRapidShypAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = sendToRapidShypInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await packAndSendToRapidShyp({ id: session.user.id, role: "ADMIN" }, parsed.data);
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

/**
 * Admin equivalent of the seller's packAndScheduleMockPickupAction — the
 * explicit "use manual logistics" choice for a KISAN4U_COURIER order,
 * unscoped. Packs the order first if needed, then schedules the mock
 * pickup, as one click.
 */
export async function packAndScheduleMockPickupAction(sellerOrderId: string): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const result = await packAndScheduleMockPickup(
    { id: session.user.id, role: "ADMIN" },
    sellerOrderId,
  );
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

/**
 * Admin-only: accepts a CONFIRMED order on the seller's behalf, picking one
 * of THAT SELLER's own approved, active pickup points — for a seller who
 * isn't acting promptly (e.g. a POS order placed while the seller wasn't
 * around). A real, audited workflow function, not the generic manual
 * status-override — see order-workflow.ts's acceptOrderAsAdmin doc comment
 * for why the override path can't be used to skip pickup-point assignment.
 */
export async function acceptOrderAsAdminAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = acceptOrderInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await acceptOrderAsAdmin(session.user.id, parsed.data);
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

/** Admin-only: pulls live tracking status from RapidShyp for an order already sent there. */
export async function refreshRapidShypStatusAction(sellerOrderId: string): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const result = await refreshRapidShypTrackingStatus(session.user.id, sellerOrderId);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

/** Admin: the explicit "send to Delhivery" dispatch choice — packs first if needed, then dispatches. */
export async function packAndSendToDelhiveryAction(rawInput: unknown): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = sendToDelhiveryInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await packAndSendToDelhivery({ id: session.user.id, role: "ADMIN" }, parsed.data);
  if (result.ok) revalidatePath(`/admin/orders/${parsed.data.sellerOrderId}`);
  return result;
}

/** Admin-only: pulls live tracking status from Delhivery for an order already dispatched there. */
export async function refreshDelhiveryStatusAction(sellerOrderId: string): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const result = await refreshDelhiveryTrackingStatus(session.user.id, sellerOrderId);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

/**
 * Admin approves/rejects a pending post-delivery return request — see
 * packages/orders/src/refunds.ts's decideReturnRequest. On approval it also
 * auto-books the reverse pickup with the delivering courier; if that call
 * fails the return is still approved and `warning` carries the reason so
 * the admin can retry from the order page.
 */
export async function decideReturnRequestAction(
  rawInput: unknown,
  sellerOrderId: string,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const session = await requireOrdersSectionEdit();
  const parsed = decideReturnRequestInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await decideReturnRequest(session.user.id, parsed.data);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

/** Admin completes an approved return's refund — see packages/orders/src/refunds.ts's completeRefund for what's automated (WALLET) vs. requires a manually-entered reference (ORIGINAL_SOURCE/BANK_TRANSFER, until Razorpay/RazorpayX are wired in). */
export async function completeRefundAction(
  rawInput: unknown,
  sellerOrderId: string,
): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = completeRefundInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const result = await completeRefund({ id: session.user.id, role: "ADMIN" }, parsed.data);
  if (result.ok) {
    revalidatePath(`/admin/orders/${sellerOrderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin/order-scheduling");
  }
  return result;
}

/**
 * Admin-only retry for the reverse pickup — it's booked automatically when
 * the return is approved, so this is for the case that failed then, or a
 * return whose original shipment used a courier that needs different
 * package dimensions. Picks RapidShyp / Delhivery from the order's own
 * shipment; a mock/manual-logistics return has no courier to call and
 * stays a manual arrangement.
 */
export async function arrangeReturnPickupAction(
  rawInput: unknown,
  sellerOrderId: string,
): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const parsed = sendReturnToRapidShypInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const shipment = await prisma.shipment.findUnique({
    where: { sellerOrderId },
    select: { provider: true },
  });
  const actor = { id: session.user.id, role: "ADMIN" as const };
  const result =
    shipment?.provider === "DELHIVERY"
      ? await sendReturnToDelhivery(actor, parsed.data)
      : shipment?.provider === "RAPIDSHYP"
        ? await sendReturnToRapidShyp(actor, parsed.data)
        : ({ ok: false, error: "This order wasn't shipped via RapidShyp or Delhivery — arrange its return pickup manually." } as const);
  if (result.ok) revalidatePath(`/admin/orders/${sellerOrderId}`);
  return result;
}

/** @deprecated Use arrangeReturnPickupAction — kept so an in-flight client bundle doesn't 500. */
export async function sendReturnToRapidShypAction(
  rawInput: unknown,
  sellerOrderId: string,
): Promise<Result> {
  return arrangeReturnPickupAction(rawInput, sellerOrderId);
}

// ── Internal order remarks (addable at any stage, shown in the table) ──

/** List an order's internal remarks. ADMIN or order-scheduling:VIEW. */
export async function loadOrderRemarksAction(sellerOrderId: string) {
  await requireOrdersSectionView();
  return listOrderNotes(sellerOrderId);
}

/** Attach an internal remark to an order at any stage. ADMIN or order-scheduling:EDIT. */
export async function addOrderRemarkAction(
  sellerOrderId: string,
  body: string,
): Promise<Result> {
  const session = await requireOrdersSectionEdit();
  const result = await addOrderNote({
    sellerOrderId,
    body: typeof body === "string" ? body : "",
    authorId: session.user.id,
    authorName: getFullName(session.user) ?? "Staff",
    authorRole: session.user.role,
  });
  if (!result.ok) return result;
  revalidatePath("/admin/orders");
  revalidatePath("/admin/order-scheduling");
  revalidatePath(`/admin/orders/${sellerOrderId}`);
  return { ok: true };
}

// ── Customer / dealer order history (mirrors the POS "Past orders" modal) ──

export type OrderHistoryItem = {
  name: string;
  variantLabel: string | null;
  quantity: number;
  unit: string;
  imageUrl: string | null;
};

export type OrderHistoryEntry = {
  orderNumber: string;
  createdAt: string;
  status: string;
  sellerShopName: string;
  totalAmount: string;
  items: OrderHistoryItem[];
};

/**
 * This order's customer's/dealer's own past orders (most recent first) —
 * same query and shape as POS's "Past orders" modal
 * (pos/actions.ts's loadPosOrderHistoryAction), scoped by customerId, so
 * scheduling staff can see order history from the order detail page too.
 * ADMIN or order-scheduling:VIEW.
 */
export async function loadCustomerOrderHistoryAction(
  customerId: string,
): Promise<OrderHistoryEntry[]> {
  await requireOrdersSectionView();
  const { rows } = await listSellerOrdersForAdmin({
    customerId,
    page: 1,
    pageSize: 25,
    sortKey: "createdAt",
    sortDir: "desc",
  });
  const imageByItemId = await resolveOrderItemImageUrls(
    rows.flatMap((o) => o.items.map((it) => ({ ...it, key: it.id }))),
  );
  return rows.map((o) => ({
    orderNumber: o.orderNumber,
    createdAt: o.createdAt.toISOString(),
    status: o.status,
    sellerShopName: o.seller.shopName,
    totalAmount: Number(o.totalAmount).toFixed(2),
    items: o.items.map((it) => ({
      name: it.productName,
      variantLabel: it.variantLabel,
      quantity: it.quantity,
      unit: it.unit,
      imageUrl: resolveStorefrontAssetUrl(imageByItemId.get(it.id) ?? null),
    })),
  }));
}
