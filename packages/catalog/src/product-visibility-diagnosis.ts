import type { ProductAudience, ProductLifecycleStatus } from "@kisan4u/db";
import type { AudienceEligibility } from "./licence-eligibility";

export type VisibilityDiagnosis = {
  /** Does this audience see the product in their catalogue at all (as opposed to it being purchasable)? */
  visibleInCatalogue: boolean;
  /** Can this audience actually buy it right now (implies visibleInCatalogue)? */
  purchasable: boolean;
  /** Human-readable exact reason it's hidden/unavailable — null only when fully purchasable. */
  reason: string | null;
};

const AUDIENCE_INCLUDES: Record<ProductAudience, { customer: boolean; dealer: boolean }> = {
  CUSTOMER_ONLY: { customer: true, dealer: false },
  DEALER_ONLY: { customer: false, dealer: true },
  BOTH_CUSTOMER_AND_DEALER: { customer: true, dealer: true },
};

/**
 * Spec §9 — the admin compliance diagnostic panel's "exact
 * visibility/unavailability/hidden reason" requirement. Pure function (no
 * I/O) so it's trivially unit-testable and reusable from both the admin
 * product detail page and any future diagnostic surface — walks the same
 * gates the real catalogue queries enforce (queries.ts's
 * CUSTOMER_VISIBLE_WHERE / DEALER_VISIBLE_WHERE, plus the per-state
 * dealerAvailableStates check the dealer catalogue applies afterward) so
 * the explanation can never drift from what actually determines
 * visibility.
 *
 * Deliberately asymmetric between audiences, matching spec §7: a
 * Customer-audience product that's licence-blocked in every state is
 * fully hidden from the Customer catalogue (customerVisible gates presence,
 * not just purchasability) — Customer catalogue behavior is intentionally
 * left unchanged. A Dealer-audience product that's licence-blocked in
 * every state is likewise fully hidden (dealerVisible gates presence the
 * same way); it's only a *partial*, state-specific restriction
 * (dealerVisible=true but dealerAvailableStates not covering a given
 * dealer's state) that the Dealer catalogue keeps visible-but-unavailable.
 */
export function diagnoseProductVisibility(
  product: {
    lifecycleStatus: ProductLifecycleStatus;
    audience: ProductAudience;
    customerVisible: boolean;
    dealerVisible: boolean;
  },
  audience: "customer" | "dealer",
  eligibility: AudienceEligibility,
): VisibilityDiagnosis {
  const label = audience === "customer" ? "Customer" : "Dealer";

  if (product.lifecycleStatus !== "APPROVED") {
    return {
      visibleInCatalogue: false,
      purchasable: false,
      reason: `Not visible to any buyer — product status is ${product.lifecycleStatus}, not Approved.`,
    };
  }

  const includesAudience =
    audience === "customer"
      ? AUDIENCE_INCLUDES[product.audience].customer
      : AUDIENCE_INCLUDES[product.audience].dealer;
  if (!includesAudience) {
    return {
      visibleInCatalogue: false,
      purchasable: false,
      reason: `Not offered to ${label} — this product's audience is set to ${product.audience === "CUSTOMER_ONLY" ? "Customer only" : product.audience === "DEALER_ONLY" ? "Dealer only" : "Customer & Dealer"}.`,
    };
  }

  const visibleFlag = audience === "customer" ? product.customerVisible : product.dealerVisible;
  if (!visibleFlag) {
    const blocking = eligibility.blockingRequirements
      .map((b) => `"${b.name}" (${b.status})`)
      .join(", ");
    return {
      visibleInCatalogue: false,
      purchasable: false,
      reason:
        eligibility.eligibleStateIds.length === 0
          ? `Not visible to ${label} anywhere — licence compliance fully restricted this audience.${blocking ? ` Blocking: ${blocking}.` : ""}`
          : `Not visible to ${label} — flagged unavailable by compliance, pending a recalculation.`,
    };
  }

  if (eligibility.isPanIndia) {
    return { visibleInCatalogue: true, purchasable: true, reason: null };
  }

  if (eligibility.eligibleStateIds.length === 0) {
    // Visible flag is true but eligibility now computes zero states — a
    // stale/not-yet-reconciled state, since a genuine full block should
    // have already flipped visibleFlag to false. Surfaced explicitly
    // rather than silently reported as purchasable.
    return {
      visibleInCatalogue: true,
      purchasable: false,
      reason: `Visible but not currently purchasable for ${label} in any state — compliance data may be stale (see last recalculation time).`,
    };
  }

  return {
    visibleInCatalogue: true,
    purchasable: true,
    reason: `Purchasable for ${label} only in the states listed above.`,
  };
}
