import { z } from "zod";
import { customerAddressInputSchema } from "./address";

export const deliveryMethodEnum = z.enum(["KISAN4U_COURIER", "TRANSPORT"]);
export const paymentMethodEnum = z.enum([
  "COD",
  "ONLINE_FULL",
  "ONLINE_PARTIAL",
  "WALLET",
  "TRANSPORT_FULL_ONLINE",
]);

/** Mirrors packages/providers' MockPaymentOutcome — a manual-testing hook
 * only (Phase 4 spec §I4: the mock provider must be able to simulate
 * success/failure/partial/pending). It has no exploit value: it only ever
 * decides the outcome of the customer's OWN payment attempt, never an
 * amount, seller, or another customer's order. */
export const mockPaymentSimulateEnum = z.enum(["SUCCESS", "FAILURE", "PARTIAL_SUCCESS", "PENDING"]);

/**
 * `addressId` selects an existing CustomerAddress; `newAddress` adds one
 * inline at checkout time (Phase 4 spec §C2 — "checkout can use an
 * existing address or add a new one"). Exactly one must be present,
 * enforced below. `idempotencyKey` is opaque, client-generated once per
 * Place Order click (see the checkout page) and is the actual duplicate-
 * submission guard on the server (OrderIdempotencyKey.key is unique).
 */
export const checkoutInputSchema = z
  .object({
    addressId: z.string().min(1).optional(),
    newAddress: customerAddressInputSchema.omit({ id: true }).optional(),
    deliveryMethod: deliveryMethodEnum,
    paymentMethod: paymentMethodEnum,
    transportNote: z.string().trim().max(300).optional(),
    // Wallet is an additive funding source layered on top of whichever
    // paymentMethod above is chosen, never a payment method of its own
    // (see PaymentMethod.WALLET's doc comment and
    // packages/orders/src/wallet.ts). The server always re-validates the
    // live wallet balance and caps this at the amount actually payable
    // now — never trusts this number as the final applied amount.
    walletAmountApplied: z.coerce.number().min(0).optional(),
    devSimulatePaymentOutcome: mockPaymentSimulateEnum.optional(),
    idempotencyKey: z.string().min(10, "Missing idempotency key"),
    // Server-normalizes (trim + uppercase) and re-validates against the
    // live Coupon row — see validateAndPriceCoupon in
    // packages/orders/src/coupons.ts. Never trust this beyond "the
    // shopper typed something."
    couponCode: z.string().trim().min(1).max(40).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.addressId && !data.newAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["addressId"],
        message: "Select an address or add a new one",
      });
    }
    // Deliberately NOT validated here: "transportNote required when
    // deliveryMethod is TRANSPORT" needs the ROLE-resolved delivery
    // method, not this raw field — a CUSTOMER's submitted deliveryMethod
    // is always overridden server-side to KISAN4U_COURIER regardless of
    // what's sent (see runCheckout in packages/orders/src/checkout.ts),
    // so enforcing this here would wrongly reject a customer payload that
    // happens to carry a stray/forged "TRANSPORT" value. See
    // runCheckout's own transportNote check, which runs after that
    // role-based resolution.
  });

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
export type CheckoutRawInput = z.input<typeof checkoutInputSchema>;

/**
 * The Razorpay Standard Checkout success callback, handed straight to
 * completeRazorpayPayment. `paymentId` is our own internal Payment id,
 * echoed from the /checkout response's `razorpayOrder.paymentId` — never
 * a Razorpay id. Same shape the web verifyRazorpayPaymentAction takes.
 */
export const razorpayVerifyInputSchema = z.object({
  paymentId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type RazorpayVerifyInput = z.infer<typeof razorpayVerifyInputSchema>;

/** Razorpay sheet dismissed without paying — release that checkout's un-captured seller orders. */
export const checkoutAbandonInputSchema = z.object({
  checkoutGroupId: z.string().min(1),
});
export type CheckoutAbandonInput = z.infer<typeof checkoutAbandonInputSchema>;
