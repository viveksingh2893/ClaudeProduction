import { NextRequest } from "next/server";
import { completeRazorpayPayment } from "@kisan4u/orders";
import { razorpayVerifyInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Mobile equivalent of apps/web/src/app/checkout/actions.ts's
 * verifyRazorpayPaymentAction — the Razorpay native SDK's success callback
 * hands back {razorpay_payment_id, razorpay_order_id, razorpay_signature};
 * the app posts them here together with the internal Payment id it got in
 * the /checkout response's `razorpayOrder.paymentId`. completeRazorpayPayment
 * HMAC-verifies the signature AND does a live fetch against Razorpay to
 * confirm the payment is actually captured (and that its order id matches
 * our Payment.razorpayOrderId) before the order is treated as paid — the
 * client callback alone is never trusted. The /api/webhooks/razorpay
 * route is still the independent backstop.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    await requireMobileBuyerContext(req);
    const parsed = razorpayVerifyInputSchema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid payment verification payload.",
      );
    }
    const result = await completeRazorpayPayment(parsed.data);
    if (!result.ok) return jsonError(400, "PAYMENT_VERIFY_FAILED", result.error);
    return jsonOk({ ok: true });
  });
}
