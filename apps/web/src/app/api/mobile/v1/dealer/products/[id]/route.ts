import { NextRequest } from "next/server";
import { getDealerProductDetail, redactDealerPricingIfUnavailable } from "@kisan4u/catalog";
import { validateCartLine } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileApprovedDealer, withMobileApi } from "@/lib/mobile-api";

/**
 * Dealer product detail, plus a per-purchasable-unit eligibility check
 * (base product or each variant) using the exact same validateCartLine
 * the cart itself uses — mirrors apps/web/src/app/dealer/products/[id]/
 * page.tsx so "Add to Cart" vs "Request Seller" vs a specific blocking
 * reason is decided identically on mobile and web.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const dealer = await requireMobileApprovedDealer(req);
    const { id } = await params;
    const product = await getDealerProductDetail(id, dealer.dealerStateId);
    if (!product) return jsonError(404, "NOT_FOUND", "Product not found.");

    const lineCtx = { role: "DEALER" as const, dealerStateId: dealer.dealerStateId };
    const hasVariants = product.variants.length > 0;

    const baseEligibility =
      !hasVariants && product.dealerConfig
        ? await validateCartLine(product.id, null, product.dealerConfig.minOrderQty, lineCtx)
        : null;

    const variantEligibilities = hasVariants
      ? await Promise.all(
          product.variants.map((v) => validateCartLine(product.id, v.id, v.minOrderQty, lineCtx)),
        )
      : [];

    // Same redaction as the list route — a state-unavailable product must
    // never carry price data over the wire, not just have it hidden in
    // the client UI.
    return jsonOk({
      product: redactDealerPricingIfUnavailable(product),
      baseEligibility,
      variantEligibilities,
    });
  });
}
