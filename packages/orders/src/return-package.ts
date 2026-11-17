import { prisma } from "@kisan4u/db";

const DEFAULT_DIM_CM = 10;
const MIN_WEIGHT_GRAMS = 500;

export type ReturnPackageDims = {
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  weightGrams: number;
};

/**
 * Package size for an auto-booked reverse pickup. Package dimensions are
 * never captured anywhere upstream (see sendSellerOrderToRapidShyp's doc
 * comment) — a forward dispatch collects them from the admin's form each
 * time. A return that's booked automatically on approval has no such form,
 * so it estimates from the returned item: the variant's own
 * length/breadth/height (metres → cm) when on file, a 10cm cube otherwise,
 * and the item's summed weight floored at 500g.
 *
 * `override` lets the manual "retry pickup" admin action still pass exact
 * figures — any field it supplies wins.
 */
export async function estimateReturnPackageForItem(
  orderItemId: string,
  override?: Partial<ReturnPackageDims>,
): Promise<ReturnPackageDims> {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: { quantity: true, unitWeightGrams: true, variantId: true },
  });
  const variant = item?.variantId
    ? await prisma.productVariant.findUnique({
        where: { id: item.variantId },
        select: { length: true, breadth: true, height: true },
      })
    : null;

  const toCm = (metres: unknown) =>
    metres != null ? Math.max(1, Math.round(Number(metres) * 100)) : DEFAULT_DIM_CM;
  const qty = item?.quantity ?? 1;
  const unitWeight = Number(item?.unitWeightGrams ?? 0);

  return {
    lengthCm: override?.lengthCm ?? toCm(variant?.length),
    breadthCm: override?.breadthCm ?? toCm(variant?.breadth),
    heightCm: override?.heightCm ?? toCm(variant?.height),
    weightGrams: override?.weightGrams ?? Math.max(MIN_WEIGHT_GRAMS, Math.round(unitWeight * qty)),
  };
}
