import { prisma } from "@kisan4u/db";
import {
  matchShippingSlab,
  type ShippingConfigInput,
  type ShippingMatchResult,
} from "@kisan4u/validators";

export type SlabInput = { lowerWeightGrams: number; upperWeightGrams: number; price: number };
export type SlabValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validates a full slab set as ONE atomic, continuous range — a partial
 * or partially-invalid set is never accepted. Everything is compared in
 * whole grams (never floating-point kilograms) specifically to avoid the
 * boundary-precision problems the spec calls out (e.g. "0.500 to 0.501").
 */
export function validateSlabSet(
  maxWeightGrams: number,
  slabs: SlabInput[],
  aboveMaxPrice: number,
): SlabValidationResult {
  if (!Number.isInteger(maxWeightGrams) || maxWeightGrams <= 0) {
    return {
      ok: false,
      error: "Maximum weight must be a whole number of grams greater than zero.",
    };
  }
  if (aboveMaxPrice < 0)
    return { ok: false, error: "The above-maximum price must be zero or greater." };
  if (slabs.length === 0) return { ok: false, error: "At least one slab is required." };

  for (const slab of slabs) {
    if (!Number.isInteger(slab.lowerWeightGrams) || !Number.isInteger(slab.upperWeightGrams)) {
      return { ok: false, error: "Slab weight boundaries must be whole numbers of grams." };
    }
    if (slab.price < 0) return { ok: false, error: "Slab price must be zero or greater." };
    if (slab.upperWeightGrams < slab.lowerWeightGrams) {
      return {
        ok: false,
        error: `Slab upper bound (${slab.upperWeightGrams}g) must be greater than or equal to its lower bound (${slab.lowerWeightGrams}g).`,
      };
    }
  }

  // Safe: `sorted` is non-empty (checked via `slabs.length === 0` above).
  const sorted = [...slabs].sort((a, b) => a.lowerWeightGrams - b.lowerWeightGrams);

  if (sorted[0]!.lowerWeightGrams !== 0) {
    return { ok: false, error: "The first slab must start at 0 grams." };
  }
  if (sorted[sorted.length - 1]!.upperWeightGrams !== maxWeightGrams) {
    return {
      ok: false,
      error: "The final slab's upper bound must equal the maximum covered weight.",
    };
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (
      curr.lowerWeightGrams === prev.lowerWeightGrams ||
      curr.lowerWeightGrams === prev.upperWeightGrams
    ) {
      return { ok: false, error: "Duplicate slab boundary detected." };
    }
    if (curr.lowerWeightGrams < prev.upperWeightGrams) {
      return { ok: false, error: "Overlapping slabs detected." };
    }
    if (curr.lowerWeightGrams > prev.upperWeightGrams + 1) {
      return {
        ok: false,
        error:
          "Gap between slabs detected — every gram up to the maximum weight must belong to exactly one slab.",
      };
    }
  }

  return { ok: true };
}

export async function getLogisticsConfig() {
  return prisma.logisticsPricingConfig.findFirst({
    orderBy: { createdAt: "asc" },
    include: { slabs: { orderBy: { lowerWeightGrams: "asc" } } },
  });
}

/** Only an ACTIVE config is usable for a real shipping-cost calculation — an inactive/absent one must never be silently treated as "free shipping." */
export async function getActiveLogisticsConfig() {
  return prisma.logisticsPricingConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    include: { slabs: { orderBy: { lowerWeightGrams: "asc" } } },
  });
}

/** Prisma's Decimal columns don't structurally match the plain-number ShippingConfigInput the client-safe matcher expects — this is the one place that conversion happens. */
export function toShippingConfigInput(
  config: Awaited<ReturnType<typeof getActiveLogisticsConfig>>,
): ShippingConfigInput | null {
  if (!config) return null;
  return {
    maxWeightGrams: config.maxWeightGrams,
    aboveMaxPrice: Number(config.aboveMaxPrice),
    slabs: config.slabs.map((s) => ({
      lowerWeightGrams: s.lowerWeightGrams,
      upperWeightGrams: s.upperWeightGrams,
      price: Number(s.price),
    })),
  };
}

/**
 * THE single place a shipping cost is ever computed for storage — see
 * packages/catalog/src/product-submission.ts, the only caller. Always
 * re-reads the active config fresh from the database; a client-submitted
 * shippingCost is never accepted (see productConfigSchema/
 * productVariantInputSchema in @kisan4u/validators, which have no such
 * field at all). Mirrors packages/validators/src/shipping.ts's pure
 * matcher exactly, since that same function also drives the client-side
 * live-preview calculation in the product form.
 */
export async function calculateShippingCostForWeight(
  weightGrams: number | null | undefined,
): Promise<ShippingMatchResult> {
  if (weightGrams == null) {
    return { ok: false, error: "Enter a shipment weight to calculate shipping cost." };
  }
  const config = await getActiveLogisticsConfig();
  return matchShippingSlab(weightGrams, toShippingConfigInput(config));
}

export type SaveLogisticsConfigResult =
  { ok: true; configId: string } | { ok: false; error: string };

/**
 * Validates the full proposed slab set BEFORE writing anything — a
 * partially-invalid set never reaches the database. Replaces all slabs
 * for the config atomically (delete + recreate) in one transaction.
 */
export async function saveLogisticsConfig(
  configId: string | null,
  input: { maxWeightGrams: number; aboveMaxPrice: number; isActive: boolean; slabs: SlabInput[] },
): Promise<SaveLogisticsConfigResult> {
  const validation = validateSlabSet(input.maxWeightGrams, input.slabs, input.aboveMaxPrice);
  if (!validation.ok) return validation;

  const id = await prisma.$transaction(async (tx) => {
    const config = configId
      ? await tx.logisticsPricingConfig.update({
          where: { id: configId },
          data: {
            maxWeightGrams: input.maxWeightGrams,
            aboveMaxPrice: input.aboveMaxPrice,
            isActive: input.isActive,
          },
        })
      : await tx.logisticsPricingConfig.create({
          data: {
            maxWeightGrams: input.maxWeightGrams,
            aboveMaxPrice: input.aboveMaxPrice,
            isActive: input.isActive,
          },
        });

    await tx.logisticsWeightSlab.deleteMany({ where: { configId: config.id } });
    await tx.logisticsWeightSlab.createMany({
      data: input.slabs.map((slab, index) => ({
        configId: config.id,
        lowerWeightGrams: slab.lowerWeightGrams,
        upperWeightGrams: slab.upperWeightGrams,
        price: slab.price,
        sortOrder: index,
      })),
    });

    return config.id;
  });

  return { ok: true, configId: id };
}
