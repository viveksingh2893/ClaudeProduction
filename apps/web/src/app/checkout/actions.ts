"use server";

import { revalidatePath } from "next/cache";
import {
  checkout,
  completeRazorpayPayment,
  cancelUnpaidCheckoutGroup,
  buildCheckoutDrafts,
} from "@kisan4u/orders";
import { lookupPhoneAccount, requestOtp } from "@kisan4u/auth";
import { checkoutInputSchema, requestOtpSchema } from "@kisan4u/validators";
import { auth } from "@/auth";
import { requireBuyerContext, resolveDefaultCustomerStateId } from "@/lib/buyer-context";
import {
  claimGuestCart,
  clearGuestCookie,
  discardGuestCart,
  getGuestBuyerId,
} from "@/lib/guest-cart";
import { currentClientIp } from "@/lib/client-ip";

type Result =
  | {
      ok: true;
      checkoutGroupId: string;
      groupNumber: string;
      /** Set only for a real-gateway (non-COD, non-wallet-covered, non-devSimulate) checkout — the client opens the Razorpay Checkout widget against this before the order can be considered placed. */
      razorpayOrder?: { orderId: string; amountPaise: number; keyId: string; paymentId: string };
    }
  | { ok: false; error: string };

/**
 * The only Server Action for placing an order. `rawInput.idempotencyKey`
 * is minted once client-side per Place Order click and never regenerated
 * across retries within that click — see @kisan4u/orders' checkout(),
 * which uses it as the actual duplicate-submission guard (Phase 4 spec
 * §D/§Z), not just this action's own re-entrancy.
 */
export async function placeOrderAction(rawInput: unknown): Promise<Result> {
  const ctx = await requireBuyerContext();
  const parsed = checkoutInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  return checkout(ctx.userId, { role: ctx.role, dealerState: ctx.dealerState }, parsed.data);
}

type CouponPreviewResult =
  { ok: true; code: string; totalDiscount: number } | { ok: false; error: string };

/**
 * Live "does this coupon apply, and for how much" check for the checkout
 * page's Apply button — re-runs the exact same buildCheckoutDrafts the
 * real checkout() will use, so this preview can never drift from what
 * Place Order actually charges. Never trusted as the final discount
 * figure: placeOrderAction/checkout() always recomputes from scratch from
 * the submitted couponCode.
 */
export async function previewCouponAction(input: {
  couponCode: string;
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  paymentMethod: "COD" | "ONLINE_FULL" | "ONLINE_PARTIAL" | "WALLET" | "TRANSPORT_FULL_ONLINE";
}): Promise<CouponPreviewResult> {
  const ctx = await requireBuyerContext({ allowGuest: true });
  const draft = await buildCheckoutDrafts(ctx.userId, {
    role: ctx.role,
    dealerStateId: ctx.dealerState?.id ?? null,
    customerStateId:
      ctx.role === "CUSTOMER" ? await resolveDefaultCustomerStateId(ctx.userId) : null,
    deliveryMethod: ctx.role === "DEALER" ? input.deliveryMethod : "KISAN4U_COURIER",
    paymentMethod: input.paymentMethod,
    couponCode: input.couponCode,
  });
  if (!draft.ok) return { ok: false, error: draft.error };
  if (!draft.appliedCoupon) return { ok: false, error: "This coupon doesn't apply to your cart." };
  return {
    ok: true,
    code: draft.appliedCoupon.code,
    totalDiscount: draft.appliedCoupon.totalDiscount,
  };
}

type VerifyResult = { ok: true } | { ok: false; error: string };

/**
 * Called from the Razorpay Checkout widget's own success handler, once
 * the customer actually completes payment there — see
 * packages/orders/src/checkout.ts's completeRazorpayPayment for the real
 * (HMAC-verified, then live-fetched) authority. No ownership check is
 * needed beyond that: the signature alone proves this came from Razorpay
 * for a payment against our own order id.
 */
export async function verifyRazorpayPaymentAction(input: {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<VerifyResult> {
  await requireBuyerContext();
  return completeRazorpayPayment(input);
}

/**
 * Called when the Razorpay Checkout widget is dismissed without paying
 * (modal.ondismiss in checkout-form.tsx) — checkout() already created the
 * SellerOrder rows and cleared the cart before payment was known to have
 * succeeded (Razorpay needs a real order to open the widget against), so
 * without this an abandoned payment left behind a real, visible "Pending"
 * order with nothing paid. Cancels every SellerOrder from this checkout
 * attempt whose Payment never actually captured — a no-op, safely, if the
 * payment succeeded in the same moment via the client callback or webhook.
 */
export async function abandonCheckoutAction(
  checkoutGroupId: string,
): Promise<{ ok: true; cancelled: number } | { ok: false; error: string }> {
  const ctx = await requireBuyerContext();
  const result = await cancelUnpaidCheckoutGroup(ctx.userId, ctx.role, checkoutGroupId);
  if (result.ok) {
    revalidatePath("/orders");
    // cancelUnpaidCheckoutGroup restores the abandoned lines to the cart.
    revalidatePath("/cart");
    revalidatePath("/checkout");
    revalidatePath("/", "layout");
  }
  return result;
}

/* --------------------------------------------------------------------------
 * Guest checkout — mobile verification
 *
 * A not-signed-in visitor fills the checkout address form; the moment they
 * have a mobile number they must verify it before the order can be placed.
 * requestGuestOtpAction sends the code (reusing the same OTP infra as
 * customer login). The client then calls next-auth's signIn("otp", ...)
 * directly — that's what consumes the code and either signs them into their
 * existing customer account or auto-provisions one — and finally
 * claimGuestCartAction moves the guest cart onto that account. All of it
 * happens on the checkout page with no navigation, so the selected products
 * are never dropped.
 *
 * A number that's actually a registered dealer's is a different case: a
 * dealer has their own account/cart, not this guest one, so
 * requestGuestOtpAction doesn't send a code for it straight away — it just
 * reports isDealer so the client can warn "this will erase your cart" and
 * get an explicit yes/no first (Phase 5B). Only once confirmed does
 * requestDealerCheckoutOtpAction actually send the code, and a successful
 * verify goes through the normal dealer login (role: "DEALER") and
 * discardGuestCartAction instead of claiming the cart.
 * ------------------------------------------------------------------------ */

type GuestOtpResult =
  | { ok: true; isExistingCustomer: boolean; isDealer: boolean }
  | { ok: false; error: string; retryAfter?: number };

export async function requestGuestOtpAction(rawPhone: unknown): Promise<GuestOtpResult> {
  const session = await auth();
  if (session?.user) {
    return { ok: false, error: "You're already signed in — no verification needed." };
  }

  const parsed = requestOtpSchema.safeParse({ phone: rawPhone });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid mobile number." };
  }
  const phone = parsed.data.phone;

  const lookup = await lookupPhoneAccount(phone);
  // Don't send a code yet — the client shows the "this will erase your
  // cart" confirmation first; requestDealerCheckoutOtpAction sends it once
  // the buyer says OK.
  if (lookup.exists && lookup.role === "DEALER") {
    return { ok: true, isExistingCustomer: false, isDealer: true };
  }
  if (lookup.exists && lookup.role !== "CUSTOMER") {
    return {
      ok: false,
      error: "This number can't be used for customer checkout. Please sign in instead.",
    };
  }
  if (lookup.exists && lookup.role === "CUSTOMER" && !lookup.isActive) {
    return { ok: false, error: "This account has been disabled. Contact support." };
  }

  const sent = await requestOtp(phone, { purpose: "guest_checkout", ip: await currentClientIp() });
  if (!sent.ok)
    return {
      ok: false,
      error: sent.error,
      retryAfter: sent.code === "RATE_LIMITED" ? sent.retryAfter : undefined,
    };
  return {
    ok: true,
    isExistingCustomer: lookup.exists && lookup.role === "CUSTOMER",
    isDealer: false,
  };
}

/**
 * Sends the actual OTP for a phone the buyer just confirmed continuing
 * with, knowing it's a registered dealer's number and that their guest
 * cart will be erased. Re-checks the number is still a dealer's — never
 * trusts the client's earlier requestGuestOtpAction result alone.
 */
export async function requestDealerCheckoutOtpAction(rawPhone: unknown): Promise<GuestOtpResult> {
  const session = await auth();
  if (session?.user) {
    return { ok: false, error: "You're already signed in — no verification needed." };
  }

  const parsed = requestOtpSchema.safeParse({ phone: rawPhone });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid mobile number." };
  }
  const phone = parsed.data.phone;

  const lookup = await lookupPhoneAccount(phone);
  if (!lookup.exists || lookup.role !== "DEALER") {
    return { ok: false, error: "This number is no longer a dealer account — start over." };
  }

  const sent = await requestOtp(phone, { purpose: "guest_checkout", ip: await currentClientIp() });
  if (!sent.ok)
    return {
      ok: false,
      error: sent.error,
      retryAfter: sent.code === "RATE_LIMITED" ? sent.retryAfter : undefined,
    };
  return { ok: true, isExistingCustomer: false, isDealer: true };
}

/**
 * Discards the guest cart instead of claiming it — used when the buyer
 * confirmed verifying a dealer's number: that account has its own cart,
 * unrelated to whatever this guest was building here.
 */
export async function discardGuestCartAction(): Promise<{ ok: true }> {
  const guestId = await getGuestBuyerId();
  if (guestId) await discardGuestCart(guestId);
  await clearGuestCookie();
  revalidatePath("/cart");
  return { ok: true };
}

/**
 * Runs immediately after a guest signs in on the checkout page. Re-points
 * every cart row from the guest placeholder onto the now-authenticated
 * account (summing quantities where a line already exists), then
 * deactivates the placeholder and clears the cookie. A no-op when there is
 * no guest cookie, or the "guest" turned out to already be this user.
 */
export async function claimGuestCartAction(): Promise<{ ok: true; moved: number }> {
  const session = await auth();
  if (!session?.user) return { ok: true, moved: 0 };

  const guestId = await getGuestBuyerId();
  if (!guestId || guestId === session.user.id) {
    await clearGuestCookie();
    return { ok: true, moved: 0 };
  }

  const moved = await claimGuestCart(guestId, session.user.id);

  await clearGuestCookie();
  revalidatePath("/cart");
  revalidatePath("/checkout");
  return { ok: true, moved };
}
