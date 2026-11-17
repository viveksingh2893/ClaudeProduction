import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@kisan4u/providers";
import {
  completeRazorpayPaymentByOrderId,
  completeWalletTopupByRazorpayOrderId,
} from "@kisan4u/orders";

/**
 * Razorpay's server-to-server notification — the durable source of truth
 * for a captured payment, independent of the client's own post-widget
 * callback (packages/orders/src/checkout.ts's completeRazorpayPayment,
 * wired to /checkout's Server Action). A closed browser tab, a network
 * drop right after payment, or a customer who never returns to the tab
 * all mean the client callback never fires — this is what still confirms
 * the order in that case. Whichever of the two arrives first does the
 * real work; completePaymentFromRazorpay is idempotent against the other
 * arriving after.
 *
 * Must be registered in the Razorpay Dashboard (Settings → Webhooks)
 * against this route's full public URL, with `payment.captured` enabled,
 * and RAZORPAY_WEBHOOK_SECRET set to the secret Razorpay generates for
 * that webhook — until both of those are done, this route exists but
 * nothing calls it.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    // Deliberately vague — never confirms/denies whether a signature was
    // even present, same reasoning as any auth-failure response.
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const payload = event as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
  };

  if (payload.event === "payment.captured") {
    const entity = payload.payload?.payment?.entity;
    if (entity?.order_id && entity?.id) {
      // The order id belongs to exactly one of these (a checkout payment or
      // a wallet top-up); the other is a no-op. Both are idempotent against
      // the client-side callback having already completed it.
      await completeRazorpayPaymentByOrderId(entity.order_id, entity.id);
      await completeWalletTopupByRazorpayOrderId(entity.order_id, entity.id);
    }
  }
  // Every other event type (payment.failed, refund.processed, etc.) is
  // intentionally ignored for now — failure needs no action (the order
  // just stays PENDING_PAYMENT, retryable), and refund confirmation isn't
  // wired to anything yet (completeRefund's own Razorpay call already
  // gets a synchronous result).

  return NextResponse.json({ ok: true });
}
