/**
 * The price to show for a product in an admin/seller list row.
 *
 * A simple (non-variant) product keeps its price on the base
 * customerConfig/dealerConfig. A variant product's base config is a
 * placeholder — usually mrp/sellingPrice 0, or absent entirely — and the
 * real prices live on the ProductVariant rows, so a list row that reads
 * only the base config shows ₹0 for every variant product. This falls back
 * to the span of variant selling prices in that case.
 *
 * Returns null when nothing is priced yet (draft with no numbers) — the
 * caller renders that as "—".
 */
type ConfigLike = { sellingPrice: unknown } | null | undefined;
type VariantLike = { sellingPrice: unknown };

export function productPriceRange(p: {
  customerConfig?: ConfigLike;
  dealerConfig?: ConfigLike;
  variants?: VariantLike[] | null;
}): { min: number; max: number } | null {
  const base = p.customerConfig ?? p.dealerConfig;
  const basePrice = base ? Number(base.sellingPrice) : 0;
  if (Number.isFinite(basePrice) && basePrice > 0) {
    return { min: basePrice, max: basePrice };
  }

  const variantPrices = (p.variants ?? [])
    .map((v) => Number(v.sellingPrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (variantPrices.length === 0) return null;

  return { min: Math.min(...variantPrices), max: Math.max(...variantPrices) };
}

/** "₹120" when min === max, "₹120 – ₹300" for a span, "—" for null. */
export function formatPriceRange(
  range: { min: number; max: number } | null,
  format: (n: number) => string,
): string {
  if (!range) return "—";
  if (range.min === range.max) return format(range.min);
  return `${format(range.min)} – ${format(range.max)}`;
}
