import { NextRequest } from "next/server";
import { completeWalletTopup } from "@kisan4u/orders";
import { walletTopupVerifyInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Step 2 of the app's Razorpay wallet top-up — confirms the captured
 * payment (signature + a live fetch) and credits the wallet exactly once.
 * Idempotent with the payment.captured webhook. Mirror of apps/web's
 * verifyWalletTopupAction.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    await requireMobileBuyerContext(req);
    const body = await parseJsonBody(req);
    const parsed = walletTopupVerifyInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "VALIDATION_ERROR", "Invalid verification payload.");
    }
    const result = await completeWalletTopup(parsed.data);
    if (!result.ok) return jsonError(400, "WALLET_TOPUP_VERIFY_FAILED", result.error);
    return jsonOk(result);
  });
}
