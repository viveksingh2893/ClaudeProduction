import type { PaymentMethod } from "@kisan4u/db";
import { getCustomerPromoDiscountPercent } from "@kisan4u/validators";
import { decimalPercentOf, decimalToMoney, allocateProportionally, round2 } from "./money";

export { getCustomerPromoDiscountPercent };

export type SellerPromoDiscount = {
  sellerIndex: number;
  merchandiseValue: number;
  discountAmount: number;
};

export type PromoDiscountResult = {
  percent: number;
  /** The Kisan4u-borne discount computed once on the checkout-wide customer merchandise total — every per-seller allocation below sums exactly to this figure. */
  checkoutLevelDiscountAmount: number;
  perSeller: SellerPromoDiscount[];
};

/**
 * Computes the checkout-level Kisan4u-borne promotional discount ONCE (the
 * configured percent of the sum of every seller order's own merchandise
 * value — post product-level discount, pre-tax, pre-delivery-charge,
 * pre-this-discount, matching the same "seller-order merchandise value"
 * basis the collection charge uses), then allocates it back across seller
 * orders proportionally to each seller's own merchandise share.
 *
 * Independently computing "percent of each seller's own subtotal" would
 * usually already sum to the same total, but per-seller rounding can drift
 * by a paisa or two once several sellers are involved — the spec requires
 * the allocated amounts to sum EXACTLY to the checkout-level figure, so
 * this computes the total first and allocates it with a deterministic
 * largest-remainder split (see money.ts:allocateProportionally) instead.
 * Discount is always borne by Kisan4u — never netted into a seller's own
 * subtotal/discountAmount, which stay their unaffected settlement basis.
 */
export function calculateCustomerPromoDiscount(
  customerType: "CUSTOMER" | "DEALER",
  paymentMethod: PaymentMethod,
  merchandiseValues: number[],
): PromoDiscountResult {
  const percent = getCustomerPromoDiscountPercent(customerType, paymentMethod);

  if (percent === 0 || merchandiseValues.length === 0) {
    return {
      percent,
      checkoutLevelDiscountAmount: 0,
      perSeller: merchandiseValues.map((merchandiseValue, sellerIndex) => ({
        sellerIndex,
        merchandiseValue,
        discountAmount: 0,
      })),
    };
  }

  const totalMerchandiseValue = merchandiseValues.reduce((total, v) => round2(total + v), 0);
  const checkoutLevelDiscountAmount = decimalToMoney(
    decimalPercentOf(totalMerchandiseValue, percent),
  );
  const allocated = allocateProportionally(checkoutLevelDiscountAmount, merchandiseValues);

  return {
    percent,
    checkoutLevelDiscountAmount,
    perSeller: merchandiseValues.map((merchandiseValue, sellerIndex) => ({
      sellerIndex,
      merchandiseValue,
      discountAmount: allocated[sellerIndex]!,
    })),
  };
}
