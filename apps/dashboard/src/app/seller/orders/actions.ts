"use server";

import { revalidatePath } from "next/cache";
import {
  acceptOrder,
  markPackedAndReadyForPickup,
  schedulePickup,
  packAndScheduleMockPickup,
  markPickedUp,
  sellerRejectOrder,
  sendSellerOrderToRapidShyp,
  packAndSendToRapidShyp,
  packAndSendToDelhivery,
  dispatchOrderViaWizard,
  getSellerOrderForSeller,
  getSelectablePickupPoints,
} from "@kisan4u/orders";
import {
  acceptOrderInputSchema,
  markPackedInputSchema,
  schedulePickupInputSchema,
  sellerRejectOrderInputSchema,
  sendToRapidShypInputSchema,
  sendToDelhiveryInputSchema,
  dispatchViaWizardInputSchema,
} from "@kisan4u/validators";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

type Result = { ok: true } | { ok: false; error: string };

/** The Create Shipment wizard's pickup-warehouse list — the seller's own approved, active pickup points (only reachable for an order they own that has been confirmed). */
export async function sellerLoadOrderPickupPointsAction(sellerOrderId: string) {
  const { sellerProfileId } = await requireApprovedSeller();
  const order = await getSellerOrderForSeller(sellerProfileId, sellerOrderId);
  if (!order) return [];
  return getSelectablePickupPoints(sellerProfileId);
}

/** The Create Shipment wizard's one action — accept + pack + schedule via the chosen partner, scoped to this seller. */
export async function sellerDispatchViaWizardAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = dispatchViaWizardInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await dispatchOrderViaWizard(
    { id: session.user.id, role: "SELLER" },
    parsed.data,
    { sellerId: sellerProfileId },
  );
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}

export async function acceptOrderAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = acceptOrderInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await acceptOrder(sellerProfileId, session.user.id, parsed.data);
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}

/** TRANSPORT orders only — "Mark packed & ready for pickup" as one action, unchanged. See order-workflow.ts's markPackedAndReadyForPickup doc comment. KISAN4U_COURIER orders use packAndSendToRapidShypAction / packAndScheduleMockPickupAction below instead, since those orders get an explicit RapidShyp-or-mock choice. */
export async function markPackedAndReadyForPickupAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = markPackedInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await markPackedAndReadyForPickup(sellerProfileId, session.user.id, parsed.data);
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}

/**
 * Recovery action for a KISAN4U_COURIER order stuck at PACKED with no
 * shipment yet — packAndScheduleMockPickupAction below runs its pack step
 * and its schedule step as two separate, non-atomic calls, so a failure in
 * the second half (e.g. no approved pickup point yet at that moment) can
 * leave the order committed at PACKED with nothing to retry. Lets the
 * seller retry just the pickup-scheduling half once whatever blocked it is
 * resolved.
 */
export async function schedulePickupAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = schedulePickupInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await schedulePickup(sellerProfileId, session.user.id, parsed.data);
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}

/**
 * KISAN4U_COURIER orders: the explicit "use manual/mock logistics" choice,
 * offered alongside packAndSendToRapidShypAction below at SELLER_ACCEPTED
 * (and, as a recovery path, at PACKED) — see
 * packages/orders/src/order-workflow.ts's packAndScheduleMockPickup doc
 * comment. Packs the order first if needed, then schedules the mock
 * pickup, as one click.
 */
export async function packAndScheduleMockPickupAction(sellerOrderId: string): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const result = await packAndScheduleMockPickup(
    { id: session.user.id, role: "SELLER" },
    sellerOrderId,
    { sellerId: sellerProfileId },
  );
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${sellerOrderId}`);
  }
  return result;
}

/**
 * Seller-initiated push to RapidShyp for an order already at PACKED —
 * ownership-scoped via `scope: {sellerId}` so a seller can never push
 * another seller's order. Kept for the PACKED-recovery case; the normal
 * path from SELLER_ACCEPTED is packAndSendToRapidShypAction below, which
 * packs first automatically.
 */
export async function sendToRapidShypAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = sendToRapidShypInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await sendSellerOrderToRapidShyp(
    { id: session.user.id, role: "SELLER" },
    parsed.data,
    { sellerId: sellerProfileId },
  );
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}

/**
 * KISAN4U_COURIER orders: the explicit "send to RapidShyp" choice from
 * SELLER_ACCEPTED — packs the order first if needed, then dispatches, as
 * one click. See packages/orders/src/rapidshyp-shipping.ts's
 * packAndSendToRapidShyp doc comment.
 */
export async function packAndSendToRapidShypAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = sendToRapidShypInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await packAndSendToRapidShyp(
    { id: session.user.id, role: "SELLER" },
    parsed.data,
    { sellerId: sellerProfileId },
  );
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}

/** KISAN4U_COURIER orders: the explicit "send to Delhivery" choice from SELLER_ACCEPTED — packs first if needed, then dispatches, scoped to this seller. */
export async function packAndSendToDelhiveryAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = sendToDelhiveryInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await packAndSendToDelhivery(
    { id: session.user.id, role: "SELLER" },
    parsed.data,
    { sellerId: sellerProfileId },
  );
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}

export async function markPickedUpAction(sellerOrderId: string): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const result = await markPickedUp(sellerProfileId, session.user.id, sellerOrderId);
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${sellerOrderId}`);
  }
  return result;
}

export async function sellerRejectOrderAction(rawInput: unknown): Promise<Result> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  const parsed = sellerRejectOrderInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await sellerRejectOrder(sellerProfileId, session.user.id, parsed.data);
  if (result.ok) {
    revalidatePath("/seller/orders");
    revalidatePath(`/seller/orders/${parsed.data.sellerOrderId}`);
  }
  return result;
}
