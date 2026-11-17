import { NextRequest } from "next/server";
import { createWalletTopupOrder } from "@kisan4u/orders";
import { walletTopupOrderInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Step 1 of a real Razorpay-funded wallet top-up from the app — the
 * mobile mirror of apps/web/src/app/account/wallet/actions.ts's
 * createWalletTopupOrderAction. Records a PENDING WalletTopup and returns
 * the Razorpay order the app's Checkout sheet pays against; step 2 is
 * POST .../razorpay/verify (client callback, HMAC-checked) or the
 * payment.captured webhook, whichever lands first.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    if (buyer.isGuest) {
      return jsonError(403, "GUEST_MUST_VERIFY", "Verify your mobile number before adding money to your wallet.");
    }
    const body = await parseJsonBody(req);
    const parsed = walletTopupOrderInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid amount.");
    }
    const result = await createWalletTopupOrder(buyer.userId, buyer.role, parsed.data.amount);
    if (!result.ok) return jsonError(400, "WALLET_TOPUP_FAILED", result.error);
    return jsonOk(result);
  });
}
