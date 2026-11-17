import { prisma, Prisma } from "@kisan4u/db";
import { calculateShippingCostForWeight, getActiveLogisticsConfig } from "@kisan4u/catalog";
import { round2, toDecimal, decimalToMoney } from "./money";

export type ChargeContext = {
  customerType: "CUSTOMER" | "DEALER";
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  /** Not read by this module's own calculation anymore (dealer Transport no longer prices off a per-seller config — see calculateSellerOrderCharges) — kept on the context because callers already group by seller and pass it through uniformly. */
  sellerId: string;
};

export type CollectionChargeCalc = {
  sellerOrderValue: number;
  percentageUsed: number;
  minimumCharge: number;
  percentageResult: number;
  finalCharge: number;
  payer: "SELLER";
  formula: string;
};

export type ChargeCalcSuccess = {
  ok: true;
  shipmentWeightGrams: number;
  transportationCost: number;
  transportationPayer: "CUSTOMER" | "SELLER";
  collectionCharge: number;
  collectionChargePayer: "SELLER";
  collectionChargeCalc: CollectionChargeCalc;
  /** What the customer actually pays toward delivery — 0 for customer orders (transportation is seller-borne), the calculated cost for dealer Kisan4u Courier (dealer-borne), and always 0 for dealer Transport (the dealer arranges and pays transport privately, outside the platform — see calculateSellerOrderCharges). */
  customerPayableDelivery: number;
  /** What Kisan4u records/collects for accounting, regardless of who ultimately bears it. */
  kisan4uCollectedAmount: number;
  sellerBorneAmount: number;
  slabSnapshot: Record<string, unknown>;
};
export type ChargeCalcResult = ChargeCalcSuccess | { ok: false; error: string };

/**
 * Collection charge = higher of an admin-configured flat minimum or a
 * percentage of the seller-order merchandise value — always seller-borne,
 * for both customer and dealer orders, computed independently of payment
 * method (business-rule corrective spec: "Collection charge = higher of
 * ₹30 or 1.5% of the applicable seller-order value"). The admin-configured
 * CollectionChargeConfig model already expresses this generically
 * (chargeType=PERCENTAGE, value=1.5, minCharge=30 — see seed.ts), so no
 * schema change was needed to represent the new formula, only this
 * calculation rewrite (Decimal-safe) plus the fuller snapshot every
 * OrderCharge now stores. Unlike a missing logistics slab (which blocks
 * checkout, see resolveTransportationCost below), a missing/inactive
 * CollectionChargeConfig falls back to ₹0 rather than blocking — this is a
 * Kisan4u-internal accounting figure, not a customer-facing shipping
 * estimate the customer would be misled about.
 */
export async function calculateCollectionCharge(
  sellerOrderValue: number,
): Promise<CollectionChargeCalc> {
  const config = await prisma.collectionChargeConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!config) {
    return {
      sellerOrderValue,
      percentageUsed: 0,
      minimumCharge: 0,
      percentageResult: 0,
      finalCharge: 0,
      payer: "SELLER",
      formula: "No active collection-charge configuration — defaulted to ₹0.",
    };
  }

  const value = toDecimal(sellerOrderValue);
  const percentageUsed = config.chargeType === "PERCENTAGE" ? Number(config.value) : 0;
  const minimumCharge = config.minCharge != null ? Number(config.minCharge) : 0;

  let amount =
    config.chargeType === "FLAT"
      ? toDecimal(config.value)
      : value.mul(toDecimal(config.value)).div(100);
  const percentageResult = decimalToMoney(amount);

  if (config.minCharge != null) amount = Prisma.Decimal.max(amount, toDecimal(config.minCharge));
  if (config.maxCharge != null) amount = Prisma.Decimal.min(amount, toDecimal(config.maxCharge));
  const finalCharge = decimalToMoney(amount);

  const formula =
    config.chargeType === "PERCENTAGE"
      ? config.minCharge != null
        ? `Higher of ₹${minimumCharge.toFixed(2)} flat or ${percentageUsed}% of seller-order merchandise value`
        : `${percentageUsed}% of seller-order merchandise value`
      : `Flat ₹${Number(config.value).toFixed(2)}${config.minCharge != null ? ` (minimum ₹${minimumCharge.toFixed(2)})` : ""}`;

  return {
    sellerOrderValue,
    percentageUsed,
    minimumCharge,
    percentageResult,
    finalCharge,
    payer: "SELLER",
    formula,
  };
}

export type ChargeResponsibility = {
  transportationPayer: "CUSTOMER" | "SELLER";
};

/**
 * The pure core of the transportation-payer rule, extracted so it's
 * unit-testable without a database:
 *   - Customer (always Kisan4U Courier): transportation is seller-borne.
 *   - Dealer Kisan4U Courier: the dealer pays the calculated courier cost.
 *   - Dealer Transport: nominally "dealer-borne" too, but the cost itself
 *     is always ₹0 — see calculateSellerOrderCharges — so in practice
 *     nobody is charged. Kept as CUSTOMER (not SELLER) for symmetry with
 *     Kisan4U Courier and so a future non-zero Transport price would not
 *     silently fall on the seller.
 * Collection charge is NOT covered here — it is always seller-borne
 * unconditionally in every case, so there is no branching logic for it
 * worth extracting.
 */
export function determineChargeResponsibility(
  customerType: "CUSTOMER" | "DEALER",
  _deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT",
): ChargeResponsibility {
  return { transportationPayer: customerType === "DEALER" ? "CUSTOMER" : "SELLER" };
}

function buildCourierSlabSnapshot(
  weightGrams: number,
  config: Awaited<ReturnType<typeof getActiveLogisticsConfig>>,
): Record<string, unknown> {
  if (!config) return { mode: "KISAN4U_COURIER", configId: null, aboveMax: false, price: null };
  if (weightGrams > config.maxWeightGrams) {
    return {
      mode: "KISAN4U_COURIER",
      configId: config.id,
      aboveMax: true,
      price: Number(config.aboveMaxPrice),
    };
  }
  const slab = config.slabs.find(
    (s) => weightGrams >= s.lowerWeightGrams && weightGrams <= s.upperWeightGrams,
  );
  return {
    mode: "KISAN4U_COURIER",
    configId: config.id,
    aboveMax: false,
    lowerWeightGrams: slab?.lowerWeightGrams ?? null,
    upperWeightGrams: slab?.upperWeightGrams ?? null,
    price: slab ? Number(slab.price) : null,
  };
}

/**
 * Computed once per seller order (never once for a whole multi-seller
 * cart). A missing/inactive logistics config (Kisan4U Courier) fails this
 * function with `{ ok: false }`, which the checkout transaction treats as
 * blocking for that seller order specifically, never as a silent ₹0.
 *
 * Dealer Transport is the one exception to "blocking, never silent ₹0":
 * it is *always* ₹0, by design, for every seller, with no configuration
 * lookup at all. The seller only ever prices dealer variants exclusive of
 * shipping, and Transport orders are arranged and paid for privately
 * between the dealer and the transporter, outside the platform — so
 * neither side is charged here. (Kisan4U Courier is unaffected: dealer
 * Courier orders still charge the dealer the calculated courier cost,
 * same as before.)
 */
export async function calculateSellerOrderCharges(
  weightGrams: number,
  subtotal: number,
  ctx: ChargeContext,
): Promise<ChargeCalcResult> {
  const collectionChargeCalc = await calculateCollectionCharge(subtotal);
  const collectionCharge = collectionChargeCalc.finalCharge;
  const responsibility = determineChargeResponsibility(ctx.customerType, ctx.deliveryMethod);

  let transportationCost: number;
  let slabSnapshot: Record<string, unknown>;

  if (ctx.customerType === "DEALER" && ctx.deliveryMethod === "TRANSPORT") {
    transportationCost = 0;
    slabSnapshot = {
      mode: "TRANSPORT_ZERO_SHIPPING",
      reason:
        "Dealer Transport orders are not charged shipping on the platform — the dealer arranges and pays transport privately.",
    };
  } else {
    const shipping = await calculateShippingCostForWeight(weightGrams);
    if (!shipping.ok) return { ok: false, error: shipping.error };
    transportationCost = shipping.price;
    slabSnapshot = buildCourierSlabSnapshot(weightGrams, await getActiveLogisticsConfig());
  }

  const customerPayableDelivery =
    responsibility.transportationPayer === "CUSTOMER" ? transportationCost : 0;
  const sellerBorneAmount =
    (responsibility.transportationPayer === "SELLER" ? transportationCost : 0) + collectionCharge;

  return {
    ok: true,
    shipmentWeightGrams: weightGrams,
    transportationCost,
    transportationPayer: responsibility.transportationPayer,
    collectionCharge,
    collectionChargePayer: "SELLER",
    collectionChargeCalc,
    customerPayableDelivery,
    kisan4uCollectedAmount: round2(transportationCost + collectionCharge),
    sellerBorneAmount: round2(sellerBorneAmount),
    slabSnapshot,
  };
}
