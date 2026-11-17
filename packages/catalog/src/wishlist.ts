import { prisma } from "@kisan4u/db";
import { isProductAvailableForState } from "./availability";
import { CUSTOMER_INCLUDE, DEALER_CATALOGUE_SELECT, customerStateAvailabilityWhere } from "./queries";

/**
 * Product Card Design Spec: wishlist icon toggles WishlistItem, gated by
 * SiteSettings.wishlistEnabled — that gate is checked by the calling
 * Server Action (apps/web/src/app/wishlist/actions.ts), not here, matching
 * how packages/orders' cart mutation functions stay unaware of feature
 * flags and push that check to the caller (see e.g. requireBuyerContext).
 */
export async function toggleWishlistItem(
  userId: string,
  productId: string,
): Promise<{ wishlisted: boolean }> {
  const existing = await prisma.wishlistItem.findUnique({
    where: { userId_productId: { userId, productId } },
  });
  if (existing) {
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
    return { wishlisted: false };
  }
  await prisma.wishlistItem.create({ data: { userId, productId } });
  return { wishlisted: true };
}

/**
 * Batched lookup for card grids — one query per page render, not one per
 * card (avoids N+1). Returns only the ids that ARE wishlisted; callers
 * check `set.has(productId)`.
 */
export async function getWishlistedProductIds(
  userId: string,
  productIds: string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await prisma.wishlistItem.findMany({
    where: { userId, productId: { in: productIds } },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

/**
 * Audience-aware — a dealer's wishlist must never render customer pricing
 * (or vice versa), so this reuses the exact same CUSTOMER_INCLUDE/
 * DEALER_CATALOGUE_SELECT shapes every other audience-gated query uses,
 * rather than a third bespoke shape. Returns products in wishlist order
 * (most recently added first); a wishlisted product that's since become
 * ineligible for this audience (unpublished, wrong audience, etc.)
 * silently drops out rather than erroring.
 */
export async function getWishlistedProducts(
  userId: string,
  audience: "CUSTOMER" | "DEALER",
  dealerStateId: string | null,
  customerStateId?: string | null,
) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { productId: true },
  });
  const orderedIds = items.map((i) => i.productId);
  if (orderedIds.length === 0) return [];

  if (audience === "CUSTOMER") {
    const products = await prisma.product.findMany({
      where: {
        id: { in: orderedIds },
        lifecycleStatus: "APPROVED",
        customerVisible: true,
        ...customerStateAvailabilityWhere(customerStateId),
      },
      include: CUSTOMER_INCLUDE,
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: orderedIds }, lifecycleStatus: "APPROVED", dealerVisible: true },
    select: DEALER_CATALOGUE_SELECT,
  });
  const byId = new Map(
    products.map((p) => [
      p.id,
      {
        ...p,
        availableInState: isProductAvailableForState(p.dealerAvailableStates, dealerStateId),
      },
    ]),
  );
  return orderedIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => p != null);
}
