import { NextRequest } from "next/server";
import { getSellerProducts } from "@kisan4u/catalog";
import { jsonOk, requireMobileApprovedSeller, withMobileApi } from "@/lib/mobile-api";

export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const seller = await requireMobileApprovedSeller(req);
    const products = await getSellerProducts(seller.sellerProfileId);
    return jsonOk({ products });
  });
}
