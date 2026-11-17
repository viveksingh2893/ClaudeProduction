import { NextRequest } from "next/server";
import { addToCart, getCartForUser } from "@kisan4u/orders";
import { addToCartInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/** Cart, grouped by seller — same read model as apps/web/src/app/cart (getCartForUser), re-validating every line live (price/stock/state changes always reflected, never a stale value). */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const cart = await getCartForUser(buyer.userId, {
      role: buyer.role,
      dealerStateId: buyer.dealerState?.id ?? null,
    });
    return jsonOk(cart);
  });
}

/** Add to cart — price/seller/weight are always re-derived server-side; only product/variant identity and quantity ever come from the client (see addToCartInputSchema). */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const body = await parseJsonBody(req);
    const parsed = addToCartInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    }

    const result = await addToCart(
      buyer.userId,
      { role: buyer.role, dealerStateId: buyer.dealerState?.id ?? null },
      parsed.data,
    );
    if (!result.ok) return jsonError(400, "CART_ERROR", result.error);
    return jsonOk(result, 201);
  });
}
