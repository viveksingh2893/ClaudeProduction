import { NextRequest } from "next/server";
import { getWishlistedProducts, resolveCustomerCatalogueStateId } from "@kisan4u/catalog";
import { jsonOk, requireMobileBuyerContext, withMobileApi } from "@/lib/mobile-api";

/** Audience-aware — a dealer's wishlist shows dealer pricing, a customer's shows customer pricing (see getWishlistedProducts). */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const customerStateId =
      buyer.role === "CUSTOMER" ? await resolveCustomerCatalogueStateId(buyer.userId) : undefined;
    const products = await getWishlistedProducts(
      buyer.userId,
      buyer.role,
      buyer.dealerState?.id ?? null,
      customerStateId,
    );
    return jsonOk({ products });
  });
}
