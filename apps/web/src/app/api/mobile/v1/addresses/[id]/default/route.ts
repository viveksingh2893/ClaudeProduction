import { NextRequest } from "next/server";
import { setDefaultAddress } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileBuyerContext, withMobileApi } from "@/lib/mobile-api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { id } = await params;
    const result = await setDefaultAddress(buyer.userId, id);
    if (!result.ok) return jsonError(400, "ADDRESS_ERROR", result.error);
    return jsonOk(result);
  });
}
