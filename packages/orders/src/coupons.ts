import { prisma, type Coupon } from "@kisan4u/db";
import { round2, decimalToMoney, decimalPercentOf, allocateProportionally } from "./money";

export type CouponPricingInput = {
  code: string;
  userId: string;
  audience: "CUSTOMER" | "DEALER";
  /** Each seller order's merchandise value — same basis calculateCustomerPromoDiscount uses (post product-level discount, pre-tax, pre-delivery-charge). */
  sellerSubtotals: { sellerId: string; subtotal: number }[];
};

export type CouponPerSellerDiscount = { sellerId: string; discountAmount: number };

export type CouponPricingResult =
  | { ok: true; coupon: Coupon; perSeller: CouponPerSellerDiscount[]; totalDiscount: number }
  | { ok: false; error: string };

const AUDIENCE_MATCH: Record<"CUSTOMER" | "DEALER", ("CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER")[]> = {
  CUSTOMER: ["CUSTOMER_ONLY", "BOTH_CUSTOMER_AND_DEALER"],
  DEALER: ["DEALER_ONLY", "BOTH_CUSTOMER_AND_DEALER"],
};

/**
 * Looks up a coupon by code, checks every eligibility rule against live DB
 * state, and — if valid — computes the discount and allocates it across
 * seller orders proportionally to their merchandise share (the same
 * allocateProportionally split used for the existing checkout-wide promo
 * discount, see promotional-discount.ts). Shared by the POS preview, the
 * web checkout preview, and the real checkout transaction (checkout.ts) —
 * one place this logic lives, never re-derived.
 *
 * Never trusts a client-submitted discount figure: this always re-reads
 * the Coupon row and recomputes from scratch.
 */
export async function validateAndPriceCoupon(input: CouponPricingInput): Promise<CouponPricingResult> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a coupon code." };

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) return { ok: false, error: "This coupon code doesn't exist." };
  if (!coupon.isActive) return { ok: false, error: "This coupon is no longer active." };

  const now = new Date();
  if (now < coupon.startDate) return { ok: false, error: "This coupon isn't active yet." };
  if (now > coupon.endDate) return { ok: false, error: "This coupon has expired." };

  if (!AUDIENCE_MATCH[input.audience].includes(coupon.audience)) {
    return { ok: false, error: "This coupon isn't valid for your account type." };
  }

  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    return { ok: false, error: "This coupon has reached its usage limit." };
  }

  if (coupon.perUserLimit !== null) {
    const usedByUser = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId: input.userId },
    });
    if (usedByUser >= coupon.perUserLimit) {
      return { ok: false, error: "You've already used this coupon the maximum number of times." };
    }
  }

  const totalSubtotal = round2(input.sellerSubtotals.reduce((total, s) => total + s.subtotal, 0));
  const minPurchase = decimalToMoney(coupon.minPurchase);
  if (totalSubtotal < minPurchase) {
    return { ok: false, error: `This coupon needs a minimum order value of ₹${minPurchase}.` };
  }

  const discountValue = decimalToMoney(coupon.discountValue);
  let totalDiscount: number;
  switch (coupon.discountType) {
    case "FLAT":
      totalDiscount = Math.min(discountValue, totalSubtotal);
      break;
    case "PERCENTAGE": {
      const raw = decimalToMoney(decimalPercentOf(totalSubtotal, discountValue));
      const cap = coupon.maxDiscount !== null ? decimalToMoney(coupon.maxDiscount) : Infinity;
      totalDiscount = Math.min(raw, cap, totalSubtotal);
      break;
    }
    case "NONE":
    default:
      totalDiscount = 0;
      break;
  }

  if (totalDiscount <= 0) {
    return { ok: false, error: "This coupon doesn't apply to your current cart." };
  }

  const allocated = allocateProportionally(
    totalDiscount,
    input.sellerSubtotals.map((s) => s.subtotal),
  );

  return {
    ok: true,
    coupon,
    perSeller: input.sellerSubtotals.map((s, i) => ({
      sellerId: s.sellerId,
      discountAmount: allocated[i]!,
    })),
    totalDiscount,
  };
}
