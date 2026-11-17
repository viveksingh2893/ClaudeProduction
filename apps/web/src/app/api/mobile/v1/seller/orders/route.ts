import { NextRequest } from "next/server";
import { listSellerOrdersForSeller } from "@kisan4u/orders";
import type { OrderStatus } from "@kisan4u/db";
import { jsonOk, requireMobileApprovedSeller, withMobileApi } from "@/lib/mobile-api";

export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const seller = await requireMobileApprovedSeller(req);
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") as OrderStatus | null) ?? undefined;
    const orders = await listSellerOrdersForSeller(seller.sellerProfileId, status);
    return jsonOk({ orders });
  });
}
