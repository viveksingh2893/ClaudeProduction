import { prisma } from "@kisan4u/db";
import { computeAdvanceAmountPure } from "@kisan4u/validators";
import { round2 } from "./money";

export type PartialPaymentPlan = {
  advanceAmount: number;
  remainingAmount: number;
  ruleLabel: string;
};
export type ComputeAdvanceResult =
  { ok: true; plan: PartialPaymentPlan } | { ok: false; error: string };

export type ActivePartialPaymentRule = {
  ruleType: "PERCENTAGE" | "FIXED_AMOUNT" | "MIN_ADVANCE_PERCENTAGE";
  value: number;
  label: string;
};

/** An audience-specific rule (appliesTo = CUSTOMER or DEALER) wins over the generic rule (appliesTo = null), per Phase 4 spec §I3. */
async function getActivePartialPaymentConfig(customerType: "CUSTOMER" | "DEALER") {
  const specific = await prisma.partialPaymentConfig.findFirst({
    where: { isActive: true, appliesTo: customerType },
    orderBy: { createdAt: "desc" },
  });
  if (specific) return specific;
  return prisma.partialPaymentConfig.findFirst({
    where: { isActive: true, appliesTo: null },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Exposes the raw active rule (not yet applied to any total) so a caller
 * like the checkout page can pass {ruleType, value} down to a client
 * component for an instant local preview via
 * `@kisan4u/validators`'s computeAdvanceAmountPure — the same pure
 * function this module itself uses below, so the preview and the
 * authoritative calculation can never drift.
 */
export async function getActivePartialPaymentRule(
  customerType: "CUSTOMER" | "DEALER",
): Promise<ActivePartialPaymentRule | null> {
  const config = await getActivePartialPaymentConfig(customerType);
  if (!config) return null;
  return {
    ruleType: config.ruleType,
    value: Number(config.value),
    label: config.isDemo ? `${config.label} (demo configuration)` : config.label,
  };
}

/**
 * Never hardcodes a business percentage (Phase 4 spec §I3) — always reads
 * the admin-configured rule. If none exists, ONLINE_PARTIAL simply isn't
 * offered (the caller must reject the payment method rather than invent a
 * default), and the seed data's demo value is clearly labeled as such via
 * `PartialPaymentConfig.isDemo`.
 */
export async function computeAdvanceAmount(
  totalAmount: number,
  customerType: "CUSTOMER" | "DEALER",
): Promise<ComputeAdvanceResult> {
  const rule = await getActivePartialPaymentRule(customerType);
  if (!rule) {
    return {
      ok: false,
      error: "Partial payment is not currently configured. Please choose another payment method.",
    };
  }

  const { advanceAmount, remainingAmount } = computeAdvanceAmountPure(
    totalAmount,
    rule.ruleType,
    rule.value,
  );
  return {
    ok: true,
    plan: {
      advanceAmount: round2(advanceAmount),
      remainingAmount: round2(remainingAmount),
      ruleLabel: rule.label,
    },
  };
}
