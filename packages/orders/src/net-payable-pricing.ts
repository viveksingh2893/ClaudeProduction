/**
 * Bridge between the product form's "Net payable" pricing mode and the
 * settlement rates that only this package can resolve.
 *
 *  - `resolveNetPayableSellerRates` gathers the seller's commission rate
 *    (customer + dealer), the three settlement GST rates, the fixed TCS/TDS
 *    rates and the active collection-charge rule into the plain-number
 *    shape @kisan4u/validators/net-payable.ts expects. The product-form
 *    reference-data loader hands this to the browser so the live selling-
 *    price preview matches what the server will compute.
 *
 *  - `applyNetPayablePricing` is the authoritative server step: for a
 *    submission in NET_PAYABLE mode it back-solves each sellable unit's
 *    selling price from its netPayableAmount and rewrites the unit's
 *    discountType/discountValue in place, so applyProductSubmission then
 *    stores an ordinary mrp+discount row and nothing downstream
 *    (catalogue, checkout, the real settlement calculator) changes at all.
 *
 * @kisan4u/catalog can't import this package (it sits below it), so this
 * lives here and is called from the dashboard's product server actions,
 * which already depend on @kisan4u/orders.
 */
import { prisma } from "@kisan4u/db";
import { getActiveLogisticsConfig, toShippingConfigInput } from "@kisan4u/catalog";
import {
  matchShippingSlab,
  deriveSellingPriceFromNetPayable,
  maxNetPayableForMrp,
  type NetPayableRateParams,
  type NetPayableUnitParams,
} from "@kisan4u/validators";
import { resolveSettlementRates, FIXED_TCS_PERCENT, FIXED_TDS_PERCENT } from "./settlement-rates";

export type NetPayableSellerRates = {
  customer: NetPayableRateParams;
  dealer: NetPayableRateParams;
};

async function resolveCollectionChargeRule(): Promise<NetPayableRateParams["collectionCharge"]> {
  // Same lookup as packages/orders/src/charges.ts:calculateCollectionCharge.
  const config = await prisma.collectionChargeConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!config) return null;
  return {
    chargeType: config.chargeType,
    value: Number(config.value),
    minCharge: config.minCharge != null ? Number(config.minCharge) : null,
    maxCharge: config.maxCharge != null ? Number(config.maxCharge) : null,
  };
}

/** Resolve every rate the net-payable inverse needs for one seller, for both audiences. */
export async function resolveNetPayableSellerRates(
  sellerId: string,
): Promise<NetPayableSellerRates> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { commissionPercent: true, dealerCommissionPercent: true },
  });
  const [customerRates, dealerRates, collectionCharge] = await Promise.all([
    resolveSettlementRates(sellerId, "CUSTOMER"),
    resolveSettlementRates(sellerId, "DEALER"),
    resolveCollectionChargeRule(),
  ]);

  const common = {
    tcsPercent: FIXED_TCS_PERCENT,
    tdsPercent: FIXED_TDS_PERCENT,
    collectionCharge,
  };
  return {
    customer: {
      commissionPercent: Number(seller?.commissionPercent ?? 0),
      commissionGstPercent: customerRates.commissionGstPercent,
      logisticsGstPercent: customerRates.logisticsGstPercent,
      collectionChargeGstPercent: customerRates.collectionChargeGstPercent,
      ...common,
    },
    dealer: {
      commissionPercent: Number(seller?.dealerCommissionPercent ?? 0),
      commissionGstPercent: dealerRates.commissionGstPercent,
      logisticsGstPercent: dealerRates.logisticsGstPercent,
      collectionChargeGstPercent: dealerRates.collectionChargeGstPercent,
      ...common,
    },
  };
}

/** One sellable unit's pricing fields — structurally satisfied by both the strict and the draft product-submission shapes. */
type PricingUnit = {
  mrp?: number;
  weight?: number;
  discountType?: "NONE" | "FLAT" | "PERCENTAGE";
  discountValue?: number;
  netPayableAmount?: number;
  taxCalcMode?: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
};

export type NetPayableConvertibleInput = {
  priceEntryMode?: "SELLING_PRICE" | "NET_PAYABLE";
  taxPercent?: number;
  customerConfig?: PricingUnit | null;
  dealerConfig?: PricingUnit | null;
  customerVariants?: PricingUnit[];
  dealerVariants?: PricingUnit[];
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * In NET_PAYABLE mode, replace every sellable unit's discountType/
 * discountValue with the ones that produce the selling price implied by
 * its netPayableAmount. A no-op for a SELLING_PRICE submission.
 *
 * `strict` (the "Submit for approval" / edit-a-live-product path) rejects
 * the whole submission if any unit's net payable is missing, too low to
 * yield a positive price, or high enough that the price would exceed MRP —
 * with a message naming the unit and the highest net payable that would
 * fit. `strict: false` (save-as-draft) is forgiving: an un-derivable or
 * over-MRP unit is just left at "no discount" so the draft still saves,
 * and the seller fixes it before submitting.
 */
export async function applyNetPayablePricing(
  input: NetPayableConvertibleInput,
  sellerId: string,
  opts: { strict: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.priceEntryMode !== "NET_PAYABLE") return { ok: true };

  const [rates, logisticsConfig] = await Promise.all([
    resolveNetPayableSellerRates(sellerId),
    getActiveLogisticsConfig(),
  ]);
  const shippingConfig = toShippingConfigInput(logisticsConfig);
  const gstRatePercent = input.taxPercent ?? 0;

  const units: Array<{ unit: PricingUnit; label: string; audience: "customer" | "dealer" }> = [];
  if (input.customerConfig)
    units.push({ unit: input.customerConfig, label: "the customer configuration", audience: "customer" });
  if (input.dealerConfig)
    units.push({ unit: input.dealerConfig, label: "the dealer configuration", audience: "dealer" });
  (input.customerVariants ?? []).forEach((unit, i) =>
    units.push({ unit, label: `customer variant #${i + 1}`, audience: "customer" }),
  );
  (input.dealerVariants ?? []).forEach((unit, i) =>
    units.push({ unit, label: `dealer variant #${i + 1}`, audience: "dealer" }),
  );

  for (const { unit, label, audience } of units) {
    const npa = unit.netPayableAmount;
    const mrp = unit.mrp;

    const setNoDiscount = () => {
      unit.discountType = "NONE";
      unit.discountValue = 0;
    };

    // A unit with no net payable isn't priced this way — e.g. a variant
    // product's synthetic card-only base config, or a row the seller left
    // blank (the client form is the gate for that). Leave its discount as
    // submitted, don't error.
    if (npa == null || npa <= 0) continue;

    if (mrp == null || mrp <= 0) {
      if (opts.strict) {
        return {
          ok: false,
          error: `Enter an MRP for ${label} so its net payable can be checked against it.`,
        };
      }
      setNoDiscount();
      continue;
    }

    const logisticsCharge =
      unit.weight != null && unit.weight > 0
        ? (() => {
            const match = matchShippingSlab(unit.weight!, shippingConfig);
            return match.ok ? match.price : 0;
          })()
        : 0;

    if ((unit.weight == null || unit.weight <= 0) && opts.strict) {
      return {
        ok: false,
        error: `Enter a weight for ${label} — the net-payable price can't be worked out without the logistics charge.`,
      };
    }

    const unitParams: NetPayableUnitParams = {
      ...rates[audience],
      gstRatePercent,
      taxCalcMode: unit.taxCalcMode ?? "INCLUDE_WITH_PRICE",
      logisticsCharge,
    };

    const derived = deriveSellingPriceFromNetPayable(npa, unitParams);

    if (derived.sellingPrice <= 0) {
      if (opts.strict) {
        return {
          ok: false,
          error: `The net payable of ₹${npa.toFixed(2)} for ${label} is too low to work out a valid selling price — raise it.`,
        };
      }
      setNoDiscount();
      continue;
    }

    if (derived.sellingPrice > mrp + 0.005) {
      if (opts.strict) {
        const ceiling = maxNetPayableForMrp(mrp, unitParams);
        return {
          ok: false,
          error: `The net payable of ₹${npa.toFixed(2)} for ${label} works out to a selling price of ₹${derived.sellingPrice.toFixed(
            2,
          )}, above its MRP of ₹${mrp.toFixed(2)}. Lower the net payable to at most ₹${ceiling.toFixed(2)}.`,
        };
      }
      setNoDiscount();
      continue;
    }

    const off = round2(mrp - derived.sellingPrice);
    if (off <= 0.005) {
      setNoDiscount();
    } else {
      unit.discountType = "FLAT";
      unit.discountValue = off;
    }
  }

  return { ok: true };
}

/**
 * Server-side safety net for the "Submit for approval" step: a product
 * saved as a draft goes through the lenient path above, which clamps an
 * over-MRP net payable to "no discount" rather than blocking the save — so
 * a seller could, by submitting straight from a bypassed client, push a
 * product live whose stored net payable no longer matches its price. This
 * re-derives from the STORED netPayableAmount/weight and refuses the
 * submit if any unit's implied price would exceed its MRP. A no-op for a
 * SELLING_PRICE product or one with no net-payable figures stored.
 */
export async function assertStoredNetPayableWithinMrp(
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      sellerId: true,
      priceEntryMode: true,
      taxPercent: true,
      customerConfig: {
        select: { mrp: true, weight: true, netPayableAmount: true, taxCalcMode: true },
      },
      dealerConfig: {
        select: { mrp: true, weight: true, netPayableAmount: true, taxCalcMode: true },
      },
      variants: {
        select: { audience: true, mrp: true, weight: true, netPayableAmount: true, taxCalcMode: true },
      },
    },
  });
  if (!product?.sellerId || product.priceEntryMode !== "NET_PAYABLE") return { ok: true };

  const toUnit = (row: {
    mrp: unknown;
    weight: number | null;
    netPayableAmount: unknown;
    taxCalcMode: "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";
  }): PricingUnit => ({
    mrp: Number(row.mrp),
    weight: row.weight ?? undefined,
    netPayableAmount: Number(row.netPayableAmount),
    taxCalcMode: row.taxCalcMode,
    discountType: "NONE",
    discountValue: 0,
  });
  const hasNpa = (row: { netPayableAmount: unknown }) => row.netPayableAmount != null;

  const synthetic: NetPayableConvertibleInput = {
    priceEntryMode: "NET_PAYABLE",
    taxPercent: Number(product.taxPercent),
    customerConfig:
      product.customerConfig && hasNpa(product.customerConfig)
        ? toUnit(product.customerConfig)
        : null,
    dealerConfig:
      product.dealerConfig && hasNpa(product.dealerConfig) ? toUnit(product.dealerConfig) : null,
    customerVariants: product.variants
      .filter((v) => v.audience === "CUSTOMER" && hasNpa(v))
      .map(toUnit),
    dealerVariants: product.variants.filter((v) => v.audience === "DEALER" && hasNpa(v)).map(toUnit),
  };

  return applyNetPayablePricing(synthetic, product.sellerId, { strict: true });
}
