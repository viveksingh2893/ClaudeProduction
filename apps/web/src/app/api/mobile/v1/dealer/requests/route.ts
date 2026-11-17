import { NextRequest } from "next/server";
import { createProductRequest, getDealerRequests } from "@kisan4u/catalog";
import { productRequestInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileApprovedDealer,
  withMobileApi,
} from "@/lib/mobile-api";

export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const dealer = await requireMobileApprovedDealer(req);
    const requests = await getDealerRequests(dealer.dealerProfileId);
    return jsonOk({ requests });
  });
}

/** "Request Seller" — an enquiry only, for a product unavailable in the dealer's state. sellerId is always re-derived server-side from the product, dealerId always from the authenticated profile — never client input. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const dealer = await requireMobileApprovedDealer(req);
    const body = await parseJsonBody(req);
    const parsed = productRequestInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    }

    const result = await createProductRequest(dealer.dealerProfileId, parsed.data);
    if (!result.ok) return jsonError(400, "REQUEST_ERROR", result.error);
    return jsonOk(result, 201);
  });
}
