/**
 * Same rounding convention as packages/validators/src/pricing.ts's
 * round2 — reused (not reinvented) so the whole app has exactly one
 * money-rounding rule. Plain JS number arithmetic at 2-decimal precision,
 * consistent with the existing repository convention (catalog pricing,
 * shipping-slab prices) — see Phase 4 spec §V: "do not introduce two
 * different money-storage conventions." Prisma stores the result as
 * Decimal on write; this is purely the calculation-time representation.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  return round2(values.reduce((total, v) => total + v, 0));
}

/**
 * Ceiling to the next whole rupee — the customer-facing checkout total is
 * always rounded UP, never down (e.g. ₹2034.11 -> ₹2035), so the platform
 * never ends up collecting a fraction of a rupee. Subtracts a tiny epsilon
 * first so a value that's already a whole rupee to floating-point
 * precision (e.g. 2035.000000000001 from prior float math) doesn't get
 * bumped to 2036.
 */
export function roundUpToRupee(value: number): number {
  return Math.ceil(value - 1e-9);
}

// ---------------------------------------------------------------------------
// Decimal-safe helpers — corrective addition for the collection-charge
// formula and the customer promotional-discount calculation, both of which
// the business-rule spec explicitly requires to avoid JS floating-point
// arithmetic (percentage-of-money math is exactly where float drift shows
// up, e.g. 1000 * 1.5 / 100 rendering as 14.999999999999998 in plain JS).
// `Prisma.Decimal` (decimal.js under the hood) is already a transitive
// dependency of @kisan4u/db — reused here rather than adding a new money
// library. This is additive: round2/sum above are untouched and remain
// the convention for the rest of this package's existing calculations.
// ---------------------------------------------------------------------------
import { Prisma } from "@kisan4u/db";

export type MoneyValue = number | string | Prisma.Decimal;

export function toDecimal(value: MoneyValue): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Rounds a Decimal to 2 places (half-up, matching round2's Math.round convention) and returns a plain number for storage/display. */
export function decimalToMoney(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

/** value * percent / 100, computed entirely in Decimal — the caller rounds via decimalToMoney once at the end, never mid-calculation. */
export function decimalPercentOf(value: MoneyValue, percent: MoneyValue): Prisma.Decimal {
  return toDecimal(value).mul(toDecimal(percent)).div(100);
}

export type TaxCalcMode = "INCLUDE_WITH_PRICE" | "EXCLUDE_WITH_PRICE";

/**
 * Splits a line's full customer-facing price into its taxable value and
 * tax amount, respecting whether that price already has tax baked in (see
 * the Prisma TaxCalcMode enum's doc comment):
 *   - INCLUDE_WITH_PRICE: taxableValue = price / (1 + taxPercent/100);
 *     taxAmount is derived as the REMAINDER (price - taxableValue), never
 *     independently rounded, so `taxableValue + taxAmount` always
 *     reconstructs `price` back exactly — never a paisa off from rounding
 *     both halves separately. Tax is never added on top of `price`.
 *   - EXCLUDE_WITH_PRICE: taxableValue = price (unchanged); taxAmount =
 *     price * taxPercent/100, added ON TOP — the system's original (and
 *     still correct, for a seller who wants it) behavior.
 *
 * Every call site that used to compute a line/order total as `price +
 * price*taxPercent/100` must go through this instead — that formula
 * silently overcharges a customer by the tax amount a second time on any
 * product marked "tax included in selling price" (the real bug this
 * fixes: a ₹595 product showing ₹624.75 at checkout instead of staying
 * ₹595, split ₹566.66 taxable + ₹28.34 tax).
 */
export function resolveTaxBreakdown(
  price: MoneyValue,
  taxPercent: MoneyValue,
  taxCalcMode: TaxCalcMode,
): { taxableValue: number; taxAmount: number } {
  const priceDecimal = toDecimal(price);
  if (taxCalcMode === "INCLUDE_WITH_PRICE") {
    const divisor = new Prisma.Decimal(1).add(toDecimal(taxPercent).div(100));
    const taxableValue = divisor.isZero()
      ? decimalToMoney(priceDecimal)
      : decimalToMoney(priceDecimal.div(divisor));
    const taxAmount = round2(decimalToMoney(priceDecimal) - taxableValue);
    return { taxableValue, taxAmount };
  }
  const taxAmount = decimalToMoney(decimalPercentOf(priceDecimal, toDecimal(taxPercent)));
  return { taxableValue: decimalToMoney(priceDecimal), taxAmount };
}

/**
 * Splits a fixed total Decimal-exactly across N proportional shares (by
 * `weights`) so every share is rounded to 2dp AND the shares sum to
 * exactly `total` to the paisa — the "deterministic rounding method"
 * required for multi-seller promotional-discount allocation (§ calc order
 * step 10). Uses the largest-remainder method: round every share down
 * first, then hand out the leftover paise (total minus the sum of the
 * rounded-down shares) one paisa at a time to the shares with the largest
 * fractional remainder, breaking ties by original array order — fully
 * deterministic for a given (total, weights) input.
 */
export function allocateProportionally(total: MoneyValue, weights: MoneyValue[]): number[] {
  const totalDecimal = toDecimal(total);
  const weightSum = weights.reduce<Prisma.Decimal>(
    (sum, w) => sum.add(toDecimal(w)),
    new Prisma.Decimal(0),
  );
  if (weightSum.isZero() || weights.length === 0) return weights.map(() => 0);

  const paiseTotal = totalDecimal.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const rawPaiseShares = weights.map((w) => toDecimal(w).mul(paiseTotal).div(weightSum));
  const flooredPaise = rawPaiseShares.map((s) => s.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN));
  const distributed = flooredPaise.reduce<Prisma.Decimal>(
    (sum, p) => sum.add(p),
    new Prisma.Decimal(0),
  );
  let remainder = paiseTotal.sub(distributed).toNumber();

  const remainders = rawPaiseShares.map((s, i) => ({
    index: i,
    frac: s.sub(flooredPaise[i]!).toNumber(),
  }));
  remainders.sort((a, b) => b.frac - a.frac || a.index - b.index);

  const paiseShares = flooredPaise.map((p) => p.toNumber());
  for (let i = 0; i < remainders.length && remainder > 0; i++, remainder--) {
    paiseShares[remainders[i]!.index]! += 1;
  }

  return paiseShares.map((p) => round2(p / 100));
}
