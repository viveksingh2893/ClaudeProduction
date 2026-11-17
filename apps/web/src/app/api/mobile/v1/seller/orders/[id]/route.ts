import { NextRequest } from "next/server";
import { getSellerOrderForSeller } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileApprovedSeller, withMobileApi } from "@/lib/mobile-api";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const seller = await requireMobileApprovedSeller(req);
    const { id } = await params;
    const order = await getSellerOrderForSeller(seller.sellerProfileId, id);
    if (!order) return jsonError(404, "NOT_FOUND", "Order not found.");
    return jsonOk({ order });
  });
}
