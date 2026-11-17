import { NextRequest } from "next/server";
import { getWalletSummary } from "@kisan4u/orders";
import { jsonOk, requireMobileBuyerContext, withMobileApi } from "@/lib/mobile-api";

/**
 * Kisan4U Wallet balance + recent ledger for the current customer or
 * approved dealer — requireMobileBuyerContext already rejects a
 * pending/rejected/suspended dealer (must be APPROVED to reach any buyer
 * context at all), so wallet is never exposed to an unauthorized dealer
 * account by construction, not by an extra check here.
 */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const summary = await getWalletSummary(buyer.userId, buyer.role);
    return jsonOk(summary);
  });
}
