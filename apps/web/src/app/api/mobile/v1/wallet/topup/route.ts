import { NextRequest } from "next/server";
import { topUpWallet } from "@kisan4u/orders";
import { walletTopupInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Demo/dev top-up — charges through the same mock payment provider
 * checkout() uses (see packages/orders/src/wallet.ts's topUpWallet), so
 * "add money to wallet" isn't a separate invented payment flow.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const body = await parseJsonBody(req);
    const parsed = walletTopupInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid top-up amount.",
      );
    }
    const result = await topUpWallet(
      buyer.userId,
      buyer.role,
      parsed.data.amount,
      parsed.data.devSimulatePaymentOutcome,
    );
    if (!result.ok) return jsonError(400, "WALLET_TOPUP_FAILED", result.error);
    return jsonOk(result);
  });
}
