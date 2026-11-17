import { NextRequest } from "next/server";
import { getSellerPickupPoints } from "@kisan4u/orders";
import { jsonOk, requireMobileApprovedSeller, withMobileApi } from "@/lib/mobile-api";

/** Needed to accept an order (acceptOrder requires a pickupPointId) — read-only here, management stays on the web seller panel for now. */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const seller = await requireMobileApprovedSeller(req);
    const points = await getSellerPickupPoints(seller.sellerProfileId);
    return jsonOk({ points });
  });
}
