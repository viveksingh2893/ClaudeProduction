import { NextRequest } from "next/server";
import { requestReturn } from "@kisan4u/orders";
import { requestReturnInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Per-item post-delivery return request — the app mirror of apps/web's
 * RequestReturnButton. Ownership, the DELIVERED-only gate, the return
 * window, the one-open-request-per-item rule and refund-method validity
 * (WALLET always; ORIGINAL_SOURCE only for a prepaid order; BANK_TRANSFER
 * only for COD, with bank fields) all happen inside `requestReturn` — this
 * route only shapes the input. Photos/video are uploaded first via the
 * sibling `return-media` route and passed here as URLs.
 */
export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ groupId: string; sellerOrderId: string; orderItemId: string }>;
  },
) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { sellerOrderId, orderItemId } = await params;
    const body = (await parseJsonBody(req)) as Record<string, unknown>;
    const parsed = requestReturnInputSchema.safeParse({ ...body, sellerOrderId, orderItemId });
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    }

    const result = await requestReturn(buyer.userId, buyer.role, parsed.data);
    if (!result.ok) return jsonError(400, "RETURN_ERROR", result.error);
    return jsonOk(result);
  });
}
