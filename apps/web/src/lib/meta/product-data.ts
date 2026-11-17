import "server-only";
import { prisma, type UserRole } from "@kisan4u/db";

/** What a Meta product event needs about one product line: the SKU (Meta's content id), unit price in INR and name. */
export type MetaProductInfo = { sku: string; price: number; name: string };

/**
 * SKU / price / name for a product the buyer just acted on, for the
 * AddToCart / AddToWishlist pixel events. A variant carries its own
 * audience-specific SKU and price; a product without variants uses its
 * customer or dealer config (falling back to Product.sku). Null if the
 * product can't be found — tracking just skips the event then.
 */
export async function metaProductInfo(
  productId: string,
  variantId: string | null | undefined,
  role: UserRole,
): Promise<MetaProductInfo | null> {
  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { sku: true, sellingPrice: true, product: { select: { name: true } } },
    });
    return variant
      ? { sku: variant.sku, price: Number(variant.sellingPrice), name: variant.product.name }
      : null;
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      name: true,
      sku: true,
      customerConfig: { select: { sku: true, sellingPrice: true } },
      dealerConfig: { select: { sku: true, sellingPrice: true } },
    },
  });
  if (!product) return null;
  const config = role === "DEALER" ? product.dealerConfig : product.customerConfig;
  return {
    sku: config?.sku ?? product.sku,
    price: config ? Number(config.sellingPrice) : 0,
    name: product.name,
  };
}
