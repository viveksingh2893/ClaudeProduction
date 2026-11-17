import { NextRequest } from "next/server";
import { cancelUnpaidCheckoutGroup } from "@kisan4u/orders";
import { checkoutAbandonInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Mobile equivalent of apps/web/src/app/checkout/actions.ts's
 * abandonCheckoutAction — checkout() must create the SellerOrder rows and
 * clear the cart *before* payment is known to have succeeded (Razorpay
 * needs a real order to open the sheet against). If the shopper dismisses
 * the Razorpay sheet without paying, this cancels every SellerOrder from
 * that checkout attempt whose Payment never actually captured — a safe
 * no-op if the payment did in fact succeed via the client callback or the
 * webhook in the same moment.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const parsed = checkoutAbandonInputSchema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid checkout group id.",
      );
    }
    const result = await cancelUnpaidCheckoutGroup(
      buyer.userId,
      buyer.role,
      parsed.data.checkoutGroupId,
    );
    if (!result.ok) return jsonError(400, "ABANDON_FAILED", result.error);
    return jsonOk(result);
  });
}
