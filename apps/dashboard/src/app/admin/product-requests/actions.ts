"use server";

import { approveProductRequest, rejectProductRequest, getAdminRequestById } from "@kisan4u/catalog";
import { writeAuditLog, notifyUser } from "@kisan4u/orders";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Approval is purely a status + visibility change on the request row (spec
 * §7) — it never touches Product/ProductDealerConfig/CartItem. Notifies the
 * seller (their turn to act) and the dealer (their request moved forward),
 * using only public-safe facts — never the dealer's own identity back at
 * themselves is a leak risk, but the seller notification in particular must
 * never mention the dealer.
 */
export async function approveProductRequestAction(
  requestId: string,
  sellerVisibleSummary: string,
  adminNotes: string,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await approveProductRequest({ requestId, sellerVisibleSummary, adminNotes });
  if (!result.ok) return result;

  await writeAuditLog({
    actorId: session.user.id,
    actorRole: "ADMIN",
    action: "PRODUCT_REQUEST_APPROVED",
    entityType: "SellerProductRequest",
    entityId: requestId,
  });

  const request = await getAdminRequestById(requestId);
  if (request) {
    await notifyUser({
      userId: request.seller.user.id,
      title: "New dealer request",
      body: `A new request has come in for ${request.product.name}. Open it in your dealer requests to view the details.`,
    });
    await notifyUser({
      userId: request.dealer.user.id,
      title: "Your request was approved",
      body: `Request ${request.publicRequestNumber} for ${request.product.name} has been approved and forwarded to the seller.`,
    });
  }

  return { ok: true };
}

export async function rejectProductRequestAction(
  requestId: string,
  rejectionReason: string,
  adminNotes: string,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await rejectProductRequest({ requestId, rejectionReason, adminNotes });
  if (!result.ok) return result;

  await writeAuditLog({
    actorId: session.user.id,
    actorRole: "ADMIN",
    action: "PRODUCT_REQUEST_REJECTED",
    entityType: "SellerProductRequest",
    entityId: requestId,
    reason: rejectionReason,
  });

  const request = await getAdminRequestById(requestId);
  if (request) {
    await notifyUser({
      userId: request.dealer.user.id,
      title: "Your request was declined",
      body: `Request ${request.publicRequestNumber} for ${request.product.name} was declined: ${rejectionReason}`,
    });
  }

  return { ok: true };
}
