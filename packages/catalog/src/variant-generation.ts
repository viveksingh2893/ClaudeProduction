import { prisma, VariantAudience, DiscountType, ShippingCalcMode, TaxCalcMode } from "@kisan4u/db";
import { buildCombinationKey } from "./combination-key";

export type VariantRowInput = {
  /** Present = update this exact existing variant row; absent = create new. */
  id?: string;
  /** Already-resolved real ProductVariantAttributeValue ids (server resolves attributeId+slug refs to ids before calling this). */
  attributeValueIds: string[];
  sku: string;
  hsnCode: string;
  mrp: number;
  discountType: DiscountType;
  discountValue: number;
  /** Seller-entered target net payable (NET_PAYABLE price mode) — data-capture only, see the Prisma PriceEntryMode enum. Null in the ordinary SELLING_PRICE mode. */
  netPayableAmount?: number | null;
  sellingPrice: number;
  minOrderQty: number;
  stockQty: number;
  minStockQty: number;
  reorderLevel: number;
  loyaltyPoints?: number | null;
  height?: number | null;
  breadth?: number | null;
  length?: number | null;
  weight?: number | null;
  /** Always server-computed by packages/catalog/src/product-submission.ts from `weight` — never a value trusted from client input. Null when there's no active logistics-pricing config or no weight to calculate from. */
  shippingCost: number | null;
  shippingCalcMode: ShippingCalcMode;
  taxCalcMode: TaxCalcMode;
  imageUrl?: string | null;
  imageAlt?: string | null;
  /** Additional gallery images (beyond the single imageUrl/imageAlt cover) — see VariantImage's doc comment. Always fully replaced (delete-then-recreate), same convention product-submission.ts already uses for the product-level `images` array. */
  images?: Array<{ url: string; altText?: string | null; position: number; isActive: boolean }>;
  videoUrl?: string | null;
  isActive: boolean;
};

/** The subset of the Prisma client this module needs — matches both the full client and a `$transaction` callback's `tx` client. */
type CatalogTxClient = Pick<typeof prisma, "productVariant" | "productVariantValue" | "variantImage">;

/**
 * Diff-based sync — creates rows for combinations that don't already exist,
 * updates existing rows by id, and never touches an existing variant that
 * isn't present in `rows`. This is deliberately NOT "delete all, recreate
 * all": a variant the seller manually deactivated (or simply didn't
 * include in this particular submission) must never be silently
 * resurrected just because the product was edited again — see the
 * "partial-combination" requirement this implements. Removing a variant
 * entirely is its own explicit action, see removeVariant() below.
 */
export async function syncVariants(
  tx: CatalogTxClient,
  productId: string,
  audience: VariantAudience,
  rows: VariantRowInput[],
): Promise<void> {
  for (const row of rows) {
    const combinationKey = buildCombinationKey(row.attributeValueIds);
    // stockQty is deliberately excluded from this shared shape — see
    // product-submission.ts's toConfigData doc comment for the full
    // rationale (same rule, variant-level): a brand-new variant's stockQty
    // is used once, at creation, as its opening on-hand value; every edit
    // after that must go through packages/catalog/src/inventory.ts's
    // recordStockChange instead, so it's excluded from the `update` call
    // below and only spliced back in for `create`.
    const data = {
      sku: row.sku,
      hsnCode: row.hsnCode,
      combinationKey,
      // Money columns as fixed 2dp strings, never raw JS numbers — see the
      // identical note in product-submission.ts:toConfigData for why the
      // pg driver would otherwise persist a float64 tail like
      // "923.3200000000001".
      mrp: row.mrp.toFixed(2),
      discountType: row.discountType,
      discountValue: row.discountValue.toFixed(2),
      netPayableAmount: row.netPayableAmount != null ? row.netPayableAmount.toFixed(2) : null,
      sellingPrice: row.sellingPrice.toFixed(2),
      minOrderQty: row.minOrderQty,
      minStockQty: row.minStockQty,
      reorderLevel: row.reorderLevel,
      loyaltyPoints: row.loyaltyPoints ?? null,
      height: row.height ?? null,
      breadth: row.breadth ?? null,
      length: row.length ?? null,
      weight: row.weight ?? null,
      shippingCost: row.shippingCost,
      shippingCalcMode: row.shippingCalcMode,
      taxCalcMode: row.taxCalcMode,
      imageUrl: row.imageUrl || null,
      imageAlt: row.imageAlt || null,
      videoUrl: row.videoUrl || null,
      isActive: row.isActive,
    };

    let variantId: string;
    if (row.id) {
      await tx.productVariant.update({ where: { id: row.id }, data });
      // The combination itself shouldn't normally change on an edit, but
      // keep the join rows consistent with whatever the form now claims
      // this variant's values are, rather than silently ignoring a change.
      await tx.productVariantValue.deleteMany({ where: { variantId: row.id } });
      await tx.productVariantValue.createMany({
        data: row.attributeValueIds.map((attributeValueId) => ({
          variantId: row.id!,
          attributeValueId,
        })),
      });
      variantId = row.id;
    } else {
      const created = await tx.productVariant.create({
        data: {
          ...data,
          stockQty: row.stockQty,
          productId,
          audience,
          values: {
            create: row.attributeValueIds.map((attributeValueId) => ({ attributeValueId })),
          },
        },
      });
      variantId = created.id;
    }

    // Additional gallery images — always fully replaced, same
    // delete-then-recreate convention product-submission.ts already uses
    // for the product-level `images` array (see its doc comment).
    await tx.variantImage.deleteMany({ where: { variantId } });
    if (row.images && row.images.length > 0) {
      await tx.variantImage.createMany({
        data: row.images.map((img) => ({
          variantId,
          url: img.url,
          altText: img.altText || null,
          position: img.position,
          isActive: img.isActive,
        })),
      });
    }
  }
}

/**
 * A variant referenced by history must never be hard-deleted — deactivate
 * it instead (see removeVariant below). CartItem holds a real FK to
 * ProductVariant (checked directly); OrderItem.variantId is informational
 * only (no FK, per its schema doc comment — order line items must stay
 * renderable even after the catalogue changes), so it's matched by value
 * instead. A review's orderItemId doesn't need its own check here: a
 * review can only exist for an order that had a variant, which the
 * OrderItem check below already covers.
 */
export async function canDeleteVariant(variantId: string): Promise<boolean> {
  const [cartCount, orderItemCount] = await Promise.all([
    prisma.cartItem.count({ where: { variantId } }),
    prisma.orderItem.count({ where: { variantId } }),
  ]);
  return cartCount === 0 && orderItemCount === 0;
}

export type VariantRemovalResult = { ok: true } | { ok: false; error: string };

/** Hard-delete a variant that's never been referenced; deactivate instead if it has been (once that check exists). */
export async function removeVariant(variantId: string): Promise<VariantRemovalResult> {
  const deletable = await canDeleteVariant(variantId);
  if (!deletable) {
    return {
      ok: false,
      error: "This variant has been used and cannot be deleted — deactivate it instead.",
    };
  }
  await prisma.productVariantValue.deleteMany({ where: { variantId } });
  await prisma.variantImage.deleteMany({ where: { variantId } });
  await prisma.productVariant.delete({ where: { id: variantId } });
  return { ok: true };
}

export async function toggleVariantActive(
  variantId: string,
  isActive: boolean,
): Promise<VariantRemovalResult> {
  await prisma.productVariant.update({ where: { id: variantId }, data: { isActive } });
  return { ok: true };
}

/**
 * Product Card Design Spec §Variants ("Manage variants and default").
 * Enforces "at most one default per (productId, audience)" in application
 * code, not a DB constraint (see ProductVariant.isDefault's schema doc
 * comment) — unsets any other default for the same product+audience in
 * the same transaction so the invariant can never be violated even under
 * concurrent admin edits to different variants.
 */
export async function setDefaultVariant(
  productId: string,
  audience: VariantAudience,
  variantId: string,
): Promise<VariantRemovalResult> {
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
  if (!variant || variant.productId !== productId || variant.audience !== audience) {
    return { ok: false, error: "Selected variant does not belong to this product/audience." };
  }
  await prisma.$transaction([
    prisma.productVariant.updateMany({
      where: { productId, audience, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.productVariant.update({ where: { id: variantId }, data: { isDefault: true } }),
  ]);
  return { ok: true };
}

/** Blocks removing a product-specific attribute value that any variant (active or inactive) still references. */
export async function assertAttributeValueRemovable(
  valueId: string,
): Promise<VariantRemovalResult> {
  const usageCount = await prisma.productVariantValue.count({
    where: { attributeValueId: valueId },
  });
  if (usageCount > 0) {
    return {
      ok: false,
      error:
        "This value is used by one or more variants — remove or reassign those variants first.",
    };
  }
  return { ok: true };
}

/** Hard-delete a product-specific attribute value that no variant references; guarded by assertAttributeValueRemovable(). */
export async function removeAttributeValue(valueId: string): Promise<VariantRemovalResult> {
  const removable = await assertAttributeValueRemovable(valueId);
  if (!removable.ok) return removable;
  await prisma.productVariantAttributeValue.delete({ where: { id: valueId } });
  return { ok: true };
}
