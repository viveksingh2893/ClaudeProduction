import { NextRequest } from "next/server";
import { getSellerOrderForCustomer } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Single seller-order detail (status history, items, charges, shipment) — the tracking view, matching apps/web's order detail page (no separate "tracking" screen exists on the website either). `groupId` is accepted for URL-shape parity with the website but ownership is checked purely by sellerOrderId + customerId. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; sellerOrderId: string }> },
) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req, ["CUSTOMER", "DEALER"]);
    const { sellerOrderId } = await params;
    const order = await getSellerOrderForCustomer(userId, sellerOrderId);
    if (!order) return jsonError(404, "NOT_FOUND", "Order not found.");
    return jsonOk({ order });
  });
}
