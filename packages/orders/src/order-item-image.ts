import { prisma } from "@kisan4u/db";

/**
 * The priority chain spec §2 asks for — most orders never need anything
 * past step 1, since checkout.ts already writes `productImageUrl` at
 * order-placement time with variant-priority already resolved (see
 * line-validation.ts: `imageUrl = variantConfig.imageUrl ?? product.
 * primaryImageUrl`). This only exists for the rare legacy/edge case where
 * that snapshot is missing or blank — `productId`/`variantId` on OrderItem
 * are informational references, not enforced foreign keys (a line item
 * must stay fully renderable even after the underlying product/variant is
 * edited or deleted), so both live lookups are allowed to come back empty
 * and this falls through to null (the caller's ProductImage placeholder)
 * rather than throwing.
 */
export type OrderItemImageInput = {
  productImageUrl: string | null | undefined;
  productId: string;
  variantId: string | null;
};

export async function resolveOrderItemImageUrl(item: OrderItemImageInput): Promise<string | null> {
  if (item.productImageUrl && item.productImageUrl.trim() !== "") return item.productImageUrl;

  if (item.variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: item.variantId },
      select: { imageUrl: true, product: { select: { primaryImageUrl: true } } },
    });
    if (variant) return variant.imageUrl ?? variant.product.primaryImageUrl ?? null;
  }

  const product = await prisma.product.findUnique({
    where: { id: item.productId },
    select: { primaryImageUrl: true },
  });
  return product?.primaryImageUrl ?? null;
}

/**
 * Batched sibling of resolveOrderItemImageUrl — for an order list/detail
 * page with many line items, only the (rare) items missing a snapshot
 * trigger a live lookup, and those are batched into at most two queries
 * total regardless of how many items need it, rather than one query per
 * item. Returns a Map keyed by the caller-supplied `key` (typically the
 * OrderItem id) so callers with duplicate productId/variantId pairs still
 * get every item filled in correctly.
 */
export async function resolveOrderItemImageUrls<T extends OrderItemImageInput>(
  items: (T & { key: string })[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const missing: (T & { key: string })[] = [];

  for (const item of items) {
    if (item.productImageUrl && item.productImageUrl.trim() !== "") {
      result.set(item.key, item.productImageUrl);
    } else {
      missing.push(item);
    }
  }
  if (missing.length === 0) return result;

  const variantIds = [...new Set(missing.map((i) => i.variantId).filter((id): id is string => !!id))];
  const productIds = [...new Set(missing.map((i) => i.productId))];

  const [variants, products] = await Promise.all([
    variantIds.length > 0
      ? prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, imageUrl: true, product: { select: { primaryImageUrl: true } } },
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, primaryImageUrl: true },
    }),
  ]);
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const item of missing) {
    const variant = item.variantId ? variantById.get(item.variantId) : undefined;
    if (variant) {
      result.set(item.key, variant.imageUrl ?? variant.product.primaryImageUrl ?? null);
      continue;
    }
    result.set(item.key, productById.get(item.productId)?.primaryImageUrl ?? null);
  }

  return result;
}
