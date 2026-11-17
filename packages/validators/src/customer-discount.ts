/**
 * Customer online-payment promotional discount rate lookup (business-rule
 * corrective spec). No dependency on Prisma/DB — same reasoning as
 * pricing.ts's calculateSellingPrice: safe to import from a client
 * component too, so the checkout form can show an instant preview the
 * moment the customer switches payment method, using the exact same rate
 * table the server later re-applies authoritatively (see
 * packages/orders/src/promotional-discount.ts, which imports this rather
 * than duplicating the rate table).
 *
 * WALLET is deliberately NOT treated as "full online" — the spec requires
 * no discount to be assumed for it unless a future admin configuration
 * says otherwise, and none exists yet. Dealer orders never receive this
 * discount for any payment method.
 */
export type PromoPaymentMethod = "COD" | "ONLINE_FULL" | "ONLINE_PARTIAL" | "WALLET" | "TRANSPORT_FULL_ONLINE";
export type PromoCustomerType = "CUSTOMER" | "DEALER";

export function getCustomerPromoDiscountPercent(
  customerType: PromoCustomerType,
  paymentMethod: PromoPaymentMethod,
): number {
  if (customerType !== "CUSTOMER") return 0;
  if (paymentMethod === "ONLINE_FULL") return 5;
  if (paymentMethod === "ONLINE_PARTIAL") return 2;
  return 0;
}

export function getCustomerPromoDiscountLabel(percent: number): string | null {
  if (percent === 5) return "5% online payment discount";
  if (percent === 2) return "2% partial payment discount";
  return null;
}
