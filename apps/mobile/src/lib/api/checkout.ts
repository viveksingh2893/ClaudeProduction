import { api } from "@/lib/api-client";

export type PaymentMethod =
  "COD" | "ONLINE_FULL" | "ONLINE_PARTIAL" | "WALLET" | "TRANSPORT_FULL_ONLINE";

export type CheckoutInput = {
  addressId?: string;
  newAddress?: Record<string, unknown>;
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  paymentMethod: PaymentMethod;
  transportNote?: string;
  /** Additive Kisan4U Wallet amount applied on top of paymentMethod — never a payment method of its own. Server re-validates the live balance and caps this at the amount payable now. */
  walletAmountApplied?: number;
  couponCode?: string;
  idempotencyKey: string;
};

/**
 * `razorpayOrder` is set only when a real Razorpay Order was created for
 * this checkout's remaining (post-wallet) online charge — the app then
 * opens the Razorpay sheet against `orderId` and, on success, posts the
 * callback to verifyRazorpayPayment. Absent for COD, a fully
 * wallet-covered payment, or a dev/test checkout. Mirrors
 * @kisan4u/orders CheckoutSuccess.
 */
export type PlaceOrderResult = {
  ok: true;
  checkoutGroupId: string;
  groupNumber: string;
  razorpayOrder?: { orderId: string; amountPaise: number; keyId: string; paymentId: string };
};

export function placeOrder(input: CheckoutInput) {
  return api.post<PlaceOrderResult>("/api/mobile/v1/checkout", input);
}

/** Hand the Razorpay native SDK's success callback to the server for HMAC + live-capture verification (mirrors web's verifyRazorpayPaymentAction). */
export function verifyRazorpayPayment(input: {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  return api.post<{ ok: true }>("/api/mobile/v1/checkout/razorpay/verify", input);
}

/** Razorpay sheet dismissed without paying — cancel the un-captured SellerOrders from this attempt (mirrors web's abandonCheckoutAction). */
export function abandonCheckout(checkoutGroupId: string) {
  return api.post<{ ok: true; cancelled: number }>("/api/mobile/v1/checkout/razorpay/abandon", {
    checkoutGroupId,
  });
}

export type CheckoutPreviewMethod = {
  grossTotal: number;
  grandTotal: number;
  discountPercent: number;
  discountAmount: number;
  discountLabel: string | null;
  appliedCoupon: { code: string; totalDiscount: number } | null;
  advance: { advanceAmount: number; remainingAmount: number; ruleLabel: string } | null;
};

export type CheckoutPreviewSeller = {
  sellerId: string;
  sellerName: string;
  itemCount: number;
  totalWeightGrams: number;
  mrpTotal: number;
  subtotal: number;
  taxAmount: number;
  transportationCost: number;
  transportationPayer: "CUSTOMER" | "SELLER";
  collectionCharge: number;
  customerPayableDelivery: number;
};

export type CheckoutPreview = {
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  allowedPaymentMethods: PaymentMethod[];
  mrpTotal: number;
  sellers: CheckoutPreviewSeller[];
  methods: Partial<Record<PaymentMethod, CheckoutPreviewMethod>>;
  walletBalance: number;
};

/**
 * Read-only price-breakdown preview — same buildCheckoutDrafts /
 * computeAdvanceAmount / customer-promo-discount calculation the server
 * uses to actually charge the order (see the route's doc comment), never
 * a client-side recalculation. Call before showing the payment-method
 * list so each option's discount/advance amount is visible up front.
 */
export function getCheckoutPreview(
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT",
  couponCode?: string,
) {
  const params = new URLSearchParams({ deliveryMethod });
  if (couponCode?.trim()) params.set("couponCode", couponCode.trim());
  return api.get<CheckoutPreview>(
    `/api/mobile/v1/checkout/preview?${params.toString()}`,
  );
}

/** One key per "Place Order" tap — never regenerated on retry, which is what makes it the actual duplicate-submission guard server-side. */
export function newIdempotencyKey(): string {
  return `mob-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
