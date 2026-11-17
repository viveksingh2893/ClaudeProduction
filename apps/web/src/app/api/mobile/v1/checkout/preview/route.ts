import { NextRequest } from "next/server";
import {
  buildCheckoutDrafts,
  computeAdvanceAmount,
  getWalletSummary,
  validatePaymentMethodRules,
} from "@kisan4u/orders";
import type { PaymentMethod } from "@kisan4u/db";
import { getCustomerPromoDiscountLabel } from "@kisan4u/validators";
import { jsonError, jsonOk, requireMobileBuyerContext, withMobileApi } from "@/lib/mobile-api";

// WALLET is deliberately excluded — it's an additive amount applied on
// top of one of these, never a selectable payment method (see
// packages/orders/src/wallet.ts and payment-rules.ts).
const ALL_PAYMENT_METHODS: PaymentMethod[] = [
  "COD",
  "ONLINE_FULL",
  "ONLINE_PARTIAL",
  "TRANSPORT_FULL_ONLINE",
];

/**
 * Read-only checkout price-breakdown preview for mobile — apps/web's
 * /checkout page.tsx computes this same thing server-side via
 * buildCheckoutDrafts + computeAdvanceAmount at render time; mobile has no
 * equivalent server-rendered page, so this route exposes the identical
 * calculation (same functions, no reimplementation) as JSON, called before
 * "Place Order". The real order-creation transaction (POST /checkout,
 * calling the exact same buildCheckoutDrafts internally) re-derives every
 * number again from scratch — this preview is never trusted as the
 * charge, only shown to the shopper before they submit.
 *
 * Returns one entry per delivery-method-allowed payment method so the UI
 * can show each option's discount/advance-amount side by side before the
 * shopper picks one (Kisan4U Courier only ever allows 2-4 methods, so
 * this is a handful of buildCheckoutDrafts calls, not an expensive fan-out).
 */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const url = new URL(req.url);
    const requestedDelivery = url.searchParams.get("deliveryMethod");
    const couponCode = url.searchParams.get("couponCode")?.trim() || undefined;
    // Same server-side pin as apps/web/src/app/checkout/page.tsx: a
    // CUSTOMER can never reach TRANSPORT, regardless of what the client sends.
    const deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT" =
      buyer.role === "DEALER" && requestedDelivery === "TRANSPORT"
        ? "TRANSPORT"
        : "KISAN4U_COURIER";

    const allowedPaymentMethods = ALL_PAYMENT_METHODS.filter(
      (method) => validatePaymentMethodRules(buyer.role, deliveryMethod, method).ok,
    );
    if (allowedPaymentMethods.length === 0) {
      return jsonError(
        400,
        "NO_PAYMENT_METHODS",
        "No payment method is available for this delivery method.",
      );
    }

    const methods: Record<
      string,
      {
        grossTotal: number;
        grandTotal: number;
        discountPercent: number;
        discountAmount: number;
        discountLabel: string | null;
        appliedCoupon: { code: string; totalDiscount: number } | null;
        advance: { advanceAmount: number; remainingAmount: number; ruleLabel: string } | null;
      }
    > = {};

    let sellerBreakdown: unknown = null;
    let mrpTotal = 0;

    for (const paymentMethod of allowedPaymentMethods) {
      const draft = await buildCheckoutDrafts(buyer.userId, {
        role: buyer.role,
        dealerStateId: buyer.dealerState?.id ?? null,
        deliveryMethod,
        paymentMethod,
        couponCode,
      });
      if (!draft.ok) return jsonError(400, "CHECKOUT_PREVIEW_ERROR", draft.error);

      let advance: { advanceAmount: number; remainingAmount: number; ruleLabel: string } | null =
        null;
      if (paymentMethod === "ONLINE_PARTIAL") {
        const advanceResult = await computeAdvanceAmount(draft.grandTotal, buyer.role);
        if (advanceResult.ok) advance = advanceResult.plan;
      }

      methods[paymentMethod] = {
        grossTotal: draft.grossTotal,
        grandTotal: draft.grandTotal,
        discountPercent: draft.promoDiscountPercent,
        discountAmount: draft.promoDiscountTotal,
        discountLabel: getCustomerPromoDiscountLabel(draft.promoDiscountPercent),
        appliedCoupon: draft.appliedCoupon
          ? { code: draft.appliedCoupon.code, totalDiscount: draft.appliedCoupon.totalDiscount }
          : null,
        advance,
      };

      if (sellerBreakdown === null) {
        mrpTotal = draft.drafts.reduce(
          (total, d) => total + d.lines.reduce((t, l) => t + l.line.mrp * l.quantity, 0),
          0,
        );
        sellerBreakdown = draft.drafts.map((d) => ({
          sellerId: d.sellerId,
          sellerName: d.lines[0]?.line.sellerName ?? "",
          itemCount: d.lines.length,
          totalWeightGrams: d.totalWeightGrams,
          mrpTotal: d.lines.reduce((t, l) => t + l.line.mrp * l.quantity, 0),
          subtotal: d.subtotal,
          taxAmount: d.taxAmount,
          transportationCost: d.charges.transportationCost,
          transportationPayer: d.charges.transportationPayer,
          collectionCharge: d.charges.collectionCharge,
          customerPayableDelivery: d.charges.customerPayableDelivery,
        }));
      }
    }

    // The wallet is applied last, after every discount — its cap is the
    // method's grandTotal for COD / full prepaid, and only the COD remainder
    // for a partial order (each method's `advance` above is worked out on the
    // FULL total and is never reduced by the wallet). The client splits it
    // with computeWalletSplit from @kisan4u/validators, same as checkout() in
    // packages/orders.
    const wallet = await getWalletSummary(buyer.userId, buyer.role);

    return jsonOk({
      deliveryMethod,
      allowedPaymentMethods,
      mrpTotal,
      sellers: sellerBreakdown,
      methods,
      walletBalance: wallet.balance,
    });
  });
}
