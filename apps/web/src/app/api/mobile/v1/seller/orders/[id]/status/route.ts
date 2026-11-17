import { NextRequest } from "next/server";
import {
  acceptOrder,
  markPacked,
  schedulePickup,
  markPickedUp,
  markInTransit,
  markDelivered,
  markDeliveryFailed,
  sellerRejectOrder,
} from "@kisan4u/orders";
import {
  acceptOrderInputSchema,
  markPackedInputSchema,
  schedulePickupInputSchema,
  sellerRejectOrderInputSchema,
} from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileApprovedSeller,
  withMobileApi,
} from "@/lib/mobile-api";

type Body = { action: string } & Record<string, unknown>;

/**
 * Single dispatcher over the exact same order-workflow functions
 * apps/dashboard's seller order actions call (packages/orders' status-
 * transitions/order-workflow/cancellation) — every allowed-from-status
 * check and ownership scoping (seller can only act on their own orders)
 * happens inside those functions, never re-implemented here.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const seller = await requireMobileApprovedSeller(req);
    const { id: sellerOrderId } = await params;
    const body = (await parseJsonBody(req)) as Body;
    if (typeof body?.action !== "string")
      return jsonError(400, "VALIDATION_ERROR", "Missing action.");

    switch (body.action) {
      case "ACCEPT": {
        const parsed = acceptOrderInputSchema.safeParse({ ...body, sellerOrderId });
        if (!parsed.success)
          return jsonError(
            400,
            "VALIDATION_ERROR",
            parsed.error.issues[0]?.message ?? "Invalid input.",
          );
        const result = await acceptOrder(seller.sellerProfileId, seller.userId, parsed.data);
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      case "PACK": {
        const parsed = markPackedInputSchema.safeParse({ ...body, sellerOrderId });
        if (!parsed.success)
          return jsonError(
            400,
            "VALIDATION_ERROR",
            parsed.error.issues[0]?.message ?? "Invalid input.",
          );
        const result = await markPacked(seller.sellerProfileId, seller.userId, parsed.data);
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      case "SCHEDULE_PICKUP": {
        const parsed = schedulePickupInputSchema.safeParse({ ...body, sellerOrderId });
        if (!parsed.success)
          return jsonError(
            400,
            "VALIDATION_ERROR",
            parsed.error.issues[0]?.message ?? "Invalid input.",
          );
        const result = await schedulePickup(seller.sellerProfileId, seller.userId, parsed.data);
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      case "PICKED_UP": {
        const result = await markPickedUp(seller.sellerProfileId, seller.userId, sellerOrderId);
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      case "IN_TRANSIT": {
        const result = await markInTransit(seller.sellerProfileId, seller.userId, sellerOrderId);
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      case "DELIVERED": {
        const result = await markDelivered(seller.sellerProfileId, seller.userId, sellerOrderId);
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      case "DELIVERY_FAILED": {
        if (typeof body.reason !== "string" || !body.reason.trim()) {
          return jsonError(400, "VALIDATION_ERROR", "A reason is required.");
        }
        const result = await markDeliveryFailed(
          seller.sellerProfileId,
          seller.userId,
          sellerOrderId,
          body.reason,
        );
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      case "REJECT": {
        const parsed = sellerRejectOrderInputSchema.safeParse({ ...body, sellerOrderId });
        if (!parsed.success)
          return jsonError(
            400,
            "VALIDATION_ERROR",
            parsed.error.issues[0]?.message ?? "Invalid input.",
          );
        const result = await sellerRejectOrder(seller.sellerProfileId, seller.userId, parsed.data);
        return result.ok ? jsonOk(result) : jsonError(400, "ORDER_ERROR", result.error);
      }
      default:
        return jsonError(400, "VALIDATION_ERROR", `Unknown action "${body.action}".`);
    }
  });
}
