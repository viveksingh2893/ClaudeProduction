import { NextRequest } from "next/server";
import { getDealerRequestById } from "@kisan4u/catalog";
import { jsonError, jsonOk, requireMobileApprovedDealer, withMobileApi } from "@/lib/mobile-api";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const dealer = await requireMobileApprovedDealer(req);
    const { id } = await params;
    const request = await getDealerRequestById(dealer.dealerProfileId, id);
    if (!request) return jsonError(404, "NOT_FOUND", "Request not found.");
    return jsonOk({ request });
  });
}
