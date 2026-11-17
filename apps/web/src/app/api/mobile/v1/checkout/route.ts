import { NextRequest } from "next/server";
import { checkout } from "@kisan4u/orders";
import { checkoutInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * The only order-placement entry point for mobile — identical to apps/web's
 * placeOrderAction, calling the exact same @kisan4u/orders checkout()
 * (server-side re-validated pricing/stock/permissions, idempotency-key
 * duplicate-submission guard, multi-seller order splitting). The client
 * must mint `idempotencyKey` once per "Place Order" tap and never
 * regenerate it on retry within that tap — see checkoutInputSchema.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    if (buyer.isGuest) {
      return jsonError(
        403,
        "GUEST_MUST_VERIFY",
        "Verify your mobile number to place the order.",
      );
    }
    const body = await parseJsonBody(req);
    const parsed = checkoutInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid checkout input.",
      );
    }

    const result = await checkout(
      buyer.userId,
      { role: buyer.role, dealerState: buyer.dealerState },
      parsed.data,
    );
    if (!result.ok) return jsonError(400, "CHECKOUT_ERROR", result.error);
    return jsonOk(result, 201);
  });
}
