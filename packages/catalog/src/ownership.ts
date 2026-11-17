import { prisma } from "@kisan4u/db";

export type OwnedProductResult = { ok: true; sellerId: string } | { ok: false; error: string };

/**
 * The single server-side ownership check every seller product mutation
 * must go through — never trust a productId's owner from client input,
 * always re-derive it from the row itself and compare against the
 * caller's own SellerProfile.id (not User.id: Product.sellerId points at
 * SellerProfile, see packages/db/prisma/schema.prisma).
 */
export async function assertOwnsProduct(
  sellerProfileId: string,
  productId: string,
): Promise<OwnedProductResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { sellerId: true },
  });
  if (!product || product.sellerId !== sellerProfileId) {
    return { ok: false, error: "Product not found." };
  }
  return { ok: true, sellerId: product.sellerId };
}
