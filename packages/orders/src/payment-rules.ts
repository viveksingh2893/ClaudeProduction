import type { PaymentMethod } from "@kisan4u/db";

export type PaymentRuleResult = { ok: true } | { ok: false; error: string };

/**
 * Payment-method x delivery-method x customer-type rules from Phase 4
 * spec §G/§H1. No business rule in this repository currently enables COD
 * for dealers, so it stays blocked here — if that ever changes, it must
 * change explicitly in this one function, not be worked around per-page.
 *
 * WALLET is deliberately never allowed here for either customer type — it
 * is an additive funding source layered on top of whichever method below
 * IS selected (see checkoutInputSchema's walletAmountApplied and
 * packages/orders/src/wallet.ts), never a selectable payment method of
 * its own. The PaymentMethod.WALLET enum value is kept only for
 * historical orders created before this change.
 */
export function validatePaymentMethodRules(
  customerType: "CUSTOMER" | "DEALER",
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT",
  paymentMethod: PaymentMethod,
): PaymentRuleResult {
  if (paymentMethod === "WALLET") {
    return {
      ok: false,
      error: "Wallet is applied as an additional amount, not chosen as a separate payment method.",
    };
  }

  if (customerType === "CUSTOMER") {
    if (deliveryMethod !== "KISAN4U_COURIER") {
      return { ok: false, error: "Customer orders always ship via Kisan4U Courier." };
    }
    if (paymentMethod === "TRANSPORT_FULL_ONLINE") {
      return {
        ok: false,
        error: "This payment method is only available for dealer Transport orders.",
      };
    }
    // COD, ONLINE_FULL, ONLINE_PARTIAL allowed for a customer.
    return { ok: true };
  }

  // Dealer.
  if (deliveryMethod === "TRANSPORT") {
    if (paymentMethod !== "TRANSPORT_FULL_ONLINE") {
      return {
        ok: false,
        error:
          "Transport orders must be paid in full online — partial payment and COD are not available.",
      };
    }
    return { ok: true };
  }

  // Kisan4U Courier.
  if (paymentMethod !== "ONLINE_FULL" && paymentMethod !== "ONLINE_PARTIAL") {
    return {
      ok: false,
      error:
        "Kisan4U Courier orders must be paid online (full or partial) — COD is not available for dealers.",
    };
  }
  return { ok: true };
}
