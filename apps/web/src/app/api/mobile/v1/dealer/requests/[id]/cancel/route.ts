import { NextRequest } from "next/server";
import { cancelProductRequestAsDealer } from "@kisan4u/catalog";
import { jsonError, jsonOk, requireMobileApprovedDealer, withMobileApi } from "@/lib/mobile-api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const dealer = await requireMobileApprovedDealer(req);
    const { id } = await params;
    const result = await cancelProductRequestAsDealer(dealer.dealerProfileId, id);
    if (!result.ok) return jsonError(400, "REQUEST_ERROR", result.error);
    return jsonOk(result);
  });
}
