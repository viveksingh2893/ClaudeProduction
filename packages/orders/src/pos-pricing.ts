import { prisma, type PaymentMethod } from "@kisan4u/db";

export type PosPricingResolved = {
  discountPercent: number;
};

/**
 * The admin-configured discount rate for one payment mode — resolved
 * fresh from PosPricingConfig every call (never cached, never trusts a
 * client-submitted figure), same discipline as
 * getCustomerPromoDiscountPercent for web/dealer checkout.
 * POS-CUSTOMER-order-only; see checkout-draft.ts's isPosCustomerOrder
 * gate for where this applies instead of the hardcoded promo table.
 *
 * PARTIAL_PREPAID has no config-driven prepaid-split rate — the amount
 * collected now is entered per-order by whoever is placing it
 * (admin/employee), same as it always has been; see checkout.ts's
 * CheckoutContext.posAdvanceAmount.
 */
export async function resolvePosPricing(paymentMethod: PaymentMethod): Promise<PosPricingResolved> {
  const config = await prisma.posPricingConfig.findUnique({ where: { id: "singleton" } });
  const discountPercent =
    paymentMethod === "COD"
      ? Number(config?.codDiscountPercent ?? 0)
      : paymentMethod === "ONLINE_FULL"
        ? Number(config?.fullPrepaidDiscountPercent ?? 5)
        : paymentMethod === "ONLINE_PARTIAL"
          ? Number(config?.partialPrepaidDiscountPercent ?? 2)
          : 0;
  return { discountPercent };
}

export type PosPricingConfigView = {
  codDiscountPercent: number;
  fullPrepaidDiscountPercent: number;
  partialPrepaidDiscountPercent: number;
};

export async function getPosPricingConfig(): Promise<PosPricingConfigView> {
  const config = await prisma.posPricingConfig.findUnique({ where: { id: "singleton" } });
  return {
    codDiscountPercent: Number(config?.codDiscountPercent ?? 0),
    fullPrepaidDiscountPercent: Number(config?.fullPrepaidDiscountPercent ?? 5),
    partialPrepaidDiscountPercent: Number(config?.partialPrepaidDiscountPercent ?? 2),
  };
}

export async function savePosPricingConfig(input: PosPricingConfigView): Promise<void> {
  await prisma.posPricingConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...input },
    update: { ...input },
  });
}
