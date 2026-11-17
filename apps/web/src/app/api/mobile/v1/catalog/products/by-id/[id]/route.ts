import { NextRequest } from "next/server";
import { getCustomerProductById, resolveCustomerCatalogueStateId } from "@kisan4u/catalog";
import { jsonError, jsonOk, optionalMobileAuth, withMobileApi } from "@/lib/mobile-api";

/**
 * Resolves a dealer-product deep-link id to the canonical customer slug.
 * It deliberately returns no product fields: a dealer-only product must
 * remain completely opaque to customer/guest callers.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const auth = await optionalMobileAuth(req);
    if (auth?.role === "DEALER") {
      return jsonError(
        403,
        "WRONG_CATALOGUE",
        "Use /dealer/products/{id} for the dealer catalogue.",
      );
    }

    const { id } = await params;
    const customerStateId =
      auth?.role === "CUSTOMER" ? await resolveCustomerCatalogueStateId(auth.userId) : undefined;
    const product = await getCustomerProductById(id, customerStateId);
    if (!product) return jsonError(404, "NOT_FOUND", "Product not found.");

    return jsonOk({ slug: product.slug });
  });
}
