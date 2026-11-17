import { NextRequest } from "next/server";
import { requestCancellation, cancelPendingOrderByCustomer } from "@kisan4u/orders";
import { cancellationRequestInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

/**
 * Cancel a seller order — the app mirror of apps/web's CancelOrderButton.
 *
 * `instant: true` (the app sends it for a still-"Pending" order —
 * PENDING_PAYMENT / PAYMENT_PARTIALLY_RECEIVED) cancels outright with no
 * admin review via `cancelPendingOrderByCustomer`; anything else becomes a
 * `requestCancellation` the Kisan4U team approves. Both refuse the wrong
 * status server-side, so a stale client can't force the instant path.
 *
 * `refundMethod` (WALLET | ORIGINAL_SOURCE) is only required — and only
 * read — when real non-wallet money was already captured; the service
 * re-derives that from the order's own payment state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; sellerOrderId: string }> },
) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { sellerOrderId } = await params;
    const body = (await parseJsonBody(req)) as Record<string, unknown>;
    const instant = body.instant === true;
    const parsed = cancellationRequestInputSchema.safeParse({ ...body, sellerOrderId });
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    }

    const result = instant
      ? await cancelPendingOrderByCustomer(buyer.userId, buyer.role, parsed.data)
      : await requestCancellation(buyer.userId, buyer.role, parsed.data);
    if (!result.ok) return jsonError(400, "CANCELLATION_ERROR", result.error);
    return jsonOk(result);
  });
}
