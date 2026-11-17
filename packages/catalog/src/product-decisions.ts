import { prisma, ProductLifecycleStatus } from "@kisan4u/db";
import { richTextVisibleLength } from "@kisan4u/validators";
import { canTransition, type ProductActor } from "./lifecycle";
import { assertOwnsProduct } from "./ownership";
import { assertProductLicenceCompliant } from "./product-submission";
import { getDraftPlaceholderCategoryId } from "./product-draft";

type DecisionResult = { ok: true } | { ok: false; error: string };

async function transition(
  productId: string,
  to: ProductLifecycleStatus,
  actor: ProductActor,
  extra: { rejectionReason?: string | null } = {},
): Promise<DecisionResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { lifecycleStatus: true },
  });
  if (!product) return { ok: false, error: "Product not found." };
  if (!canTransition(product.lifecycleStatus, to, actor)) {
    return { ok: false, error: `Cannot move a ${product.lifecycleStatus} product to ${to}.` };
  }
  await prisma.product.update({
    where: { id: productId },
    data: {
      lifecycleStatus: to,
      rejectionReason:
        to === "REJECTED"
          ? (extra.rejectionReason ?? "Not specified")
          : to === "APPROVED" || to === "SUBMITTED"
            ? null
            : undefined,
    },
  });
  return { ok: true };
}

export type ProductCompletenessResult = { ok: true } | { ok: false; error: string };

/**
 * The one place a DRAFT's field completeness is actually enforced. Saving
 * a draft (createProductAction/updateProductAction, via
 * packages/catalog/src/product-draft.ts) never requires more than a name —
 * every other required field gets a safe, inert placeholder instead, so a
 * half-filled product can always be saved and revisited. That means an
 * incomplete draft is real, persisted data by the time a seller tries to
 * submit it — this is the gate that stops it from moving any further with
 * placeholder text/pricing/category still in place.
 */
export async function assertProductComplete(productId: string): Promise<ProductCompletenessResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      categoryId: true,
      hsnCode: true,
      shortDescription: true,
      description: true,
      packageSize: true,
      primaryImageUrl: true,
      audience: true,
      customerVisible: true,
      dealerVisible: true,
      customerConfig: { select: { mrp: true } },
      dealerConfig: { select: { mrp: true } },
      variants: {
        where: { isActive: true },
        select: { audience: true, hsnCode: true, mrp: true },
      },
    },
  });
  if (!product) return { ok: false, error: "Product not found." };

  const placeholderCategoryId = await getDraftPlaceholderCategoryId();
  if (product.categoryId === placeholderCategoryId) {
    return { ok: false, error: "Select a real category before submitting." };
  }
  if (!product.hsnCode.trim()) return { ok: false, error: "Enter an HSN code before submitting." };
  if (richTextVisibleLength(product.shortDescription) < 10) {
    return { ok: false, error: "Enter a short description before submitting." };
  }
  if (richTextVisibleLength(product.description) < 20) {
    return { ok: false, error: "Enter a full description before submitting." };
  }
  // A variant product has no single package size — each variant is its
  // own sellable unit — so this only applies once it's known there are
  // no (active) variants, exactly mirroring productSubmissionSchema's
  // superRefine (packages/validators/src/catalog.ts).
  if (product.variants.length === 0 && !product.packageSize.trim()) {
    return { ok: false, error: "Enter a package size before submitting." };
  }
  if (!product.primaryImageUrl.trim()) {
    return { ok: false, error: "Add a primary image before submitting." };
  }

  const needsCustomer =
    (product.audience === "CUSTOMER_ONLY" || product.audience === "BOTH_CUSTOMER_AND_DEALER") &&
    product.customerVisible;
  const needsDealer =
    (product.audience === "DEALER_ONLY" || product.audience === "BOTH_CUSTOMER_AND_DEALER") &&
    product.dealerVisible;

  if (needsCustomer) {
    const hasPricedConfig = !!product.customerConfig && Number(product.customerConfig.mrp) > 0;
    const hasPricedVariant = product.variants.some(
      (v) => v.audience === "CUSTOMER" && Number(v.mrp) > 0 && (v.hsnCode ?? "").trim(),
    );
    if (!hasPricedConfig && !hasPricedVariant) {
      return {
        ok: false,
        error: "Set customer pricing (or add a priced customer variant) before submitting.",
      };
    }
  }
  if (needsDealer) {
    const hasPricedConfig = !!product.dealerConfig && Number(product.dealerConfig.mrp) > 0;
    const hasPricedVariant = product.variants.some(
      (v) => v.audience === "DEALER" && Number(v.mrp) > 0 && (v.hsnCode ?? "").trim(),
    );
    if (!hasPricedConfig && !hasPricedVariant) {
      return {
        ok: false,
        error: "Set dealer pricing (or add a priced dealer variant) before submitting.",
      };
    }
  }

  return { ok: true };
}

/** Seller: DRAFT or REJECTED -> SUBMITTED. Ownership must be checked first by the caller's server action. Field completeness and licence compliance are both re-checked here too — a non-compliant or still-incomplete product may only ever be retained as a DRAFT (spec §6/§14), never submitted. */
export async function submitProductForApproval(
  sellerId: string,
  productId: string,
): Promise<DecisionResult> {
  const owns = await assertOwnsProduct(sellerId, productId);
  if (!owns.ok) return owns;
  const completeness = await assertProductComplete(productId);
  if (!completeness.ok) return completeness;
  const licenceCheck = await assertProductLicenceCompliant(productId);
  if (!licenceCheck.ok) return licenceCheck;
  return transition(productId, "SUBMITTED", "SELLER");
}

/** Seller: REJECTED -> DRAFT, so they can keep editing before resubmitting. */
export async function revertProductToDraft(
  sellerId: string,
  productId: string,
): Promise<DecisionResult> {
  const owns = await assertOwnsProduct(sellerId, productId);
  if (!owns.ok) return owns;
  return transition(productId, "DRAFT", "SELLER");
}

/** Seller: APPROVED -> INACTIVE (pulling their own live listing). */
export async function deactivateOwnProduct(
  sellerId: string,
  productId: string,
): Promise<DecisionResult> {
  const owns = await assertOwnsProduct(sellerId, productId);
  if (!owns.ok) return owns;
  return transition(productId, "INACTIVE", "SELLER");
}

/**
 * Blocks approval when a config/variant has a shipment weight but no
 * computed shippingCost — that combination only happens when there was
 * no ACTIVE logistics-pricing config the last time this product was
 * saved (see packages/catalog/src/product-submission.ts:
 * computeShippingCost, which stores null rather than silently
 * defaulting to zero). Configuring logistics pricing now doesn't
 * retroactively fix already-saved rows; the seller/admin must re-save
 * the product once pricing is active so it recalculates. A missing
 * weight entirely is not blocked here — that's a legitimate "no
 * shipment weight recorded" case, distinct from "weight given but
 * pricing unavailable."
 */
async function assertShippingCostAvailable(productId: string): Promise<DecisionResult> {
  const [customerConfig, dealerConfig, variants] = await Promise.all([
    prisma.productCustomerConfig.findUnique({
      where: { productId },
      select: { weight: true, shippingCost: true },
    }),
    prisma.productDealerConfig.findUnique({
      where: { productId },
      select: { weight: true, shippingCost: true },
    }),
    prisma.productVariant.findMany({
      where: { productId },
      select: { weight: true, shippingCost: true, sku: true },
    }),
  ]);

  if (customerConfig && customerConfig.weight != null && customerConfig.shippingCost == null) {
    return {
      ok: false,
      error:
        "Customer configuration has a shipment weight but no calculated shipping cost — configure active logistics pricing and re-save the product before approving.",
    };
  }
  if (dealerConfig && dealerConfig.weight != null && dealerConfig.shippingCost == null) {
    return {
      ok: false,
      error:
        "Dealer configuration has a shipment weight but no calculated shipping cost — configure active logistics pricing and re-save the product before approving.",
    };
  }
  const badVariant = variants.find((v) => v.weight != null && v.shippingCost == null);
  if (badVariant) {
    return {
      ok: false,
      error: `Variant "${badVariant.sku}" has a shipment weight but no calculated shipping cost — configure active logistics pricing and re-save the product before approving.`,
    };
  }
  return { ok: true };
}

/**
 * Admin: SUBMITTED -> APPROVED. Caller's server action must independently
 * verify the actor is an admin. Spec §14: "Admin product approval must not
 * override a missing legal licence" — re-checked here regardless of what
 * the product looked like at submission time, since a licence could have
 * expired/been revoked in the interim.
 */
export async function approveProduct(productId: string): Promise<DecisionResult> {
  const licenceCheck = await assertProductLicenceCompliant(productId);
  if (!licenceCheck.ok) return licenceCheck;
  const shippingCheck = await assertShippingCostAvailable(productId);
  if (!shippingCheck.ok) return shippingCheck;
  return transition(productId, "APPROVED", "ADMIN");
}

/** Admin: SUBMITTED -> REJECTED, always with a reason. */
export async function rejectProduct(productId: string, reason: string): Promise<DecisionResult> {
  return transition(productId, "REJECTED", "ADMIN", { rejectionReason: reason });
}

/** Admin: APPROVED -> SUSPENDED. */
export async function suspendProduct(productId: string): Promise<DecisionResult> {
  return transition(productId, "SUSPENDED", "ADMIN");
}

/** Admin: SUSPENDED or INACTIVE -> APPROVED. */
export async function reactivateProduct(productId: string): Promise<DecisionResult> {
  const licenceCheck = await assertProductLicenceCompliant(productId);
  if (!licenceCheck.ok) return licenceCheck;
  const shippingCheck = await assertShippingCostAvailable(productId);
  if (!shippingCheck.ok) return shippingCheck;
  return transition(productId, "APPROVED", "ADMIN");
}

/**
 * Seller: INACTIVE -> APPROVED — the mirror of deactivateOwnProduct,
 * bringing their own previously-live listing back. Deliberately reuses
 * `transition`, whose canTransition check (see ./lifecycle.ts) only
 * allows SELLER to reach APPROVED from INACTIVE, never from SUSPENDED —
 * a suspension can only ever be lifted by an admin (reactivateProduct
 * above), so a SUSPENDED product's owner calling this simply gets
 * "Cannot move a SUSPENDED product to APPROVED" rather than silently
 * undoing the admin's enforcement action. Re-checks licence compliance
 * and shipping-cost availability exactly like the admin path, since
 * either could have changed while the listing was inactive.
 */
export async function reactivateOwnProduct(
  sellerId: string,
  productId: string,
): Promise<DecisionResult> {
  const owns = await assertOwnsProduct(sellerId, productId);
  if (!owns.ok) return owns;
  const licenceCheck = await assertProductLicenceCompliant(productId);
  if (!licenceCheck.ok) return licenceCheck;
  const shippingCheck = await assertShippingCostAvailable(productId);
  if (!shippingCheck.ok) return shippingCheck;
  return transition(productId, "APPROVED", "SELLER");
}

/** Admin: APPROVED -> INACTIVE. */
export async function adminDeactivateProduct(productId: string): Promise<DecisionResult> {
  return transition(productId, "INACTIVE", "ADMIN");
}

/**
 * Admin: permanently erases a product row and everything scoped to it
 * (variants, images, customer/dealer configs, cart lines, wishlist entries,
 * reviews, restock subscriptions, compliance reviews, merchandising/deal
 * placements). Blocked if the product was ever ordered — OrderItem keeps
 * a denormalized productId (not a real FK) precisely so order history
 * survives a seller/product being removed later, but a product that has
 * live order history should be Deactivated, not erased, so that history
 * stays traceable to a real product record. StockAdjustment rows cascade
 * automatically (onDelete: Cascade in the schema); everything else here
 * has no cascade defined, so each dependent table is cleared explicitly
 * in FK-safe order (ProductVariantValue before ProductVariant/
 * ProductVariantAttributeValue, everything else before Product itself).
 */
export async function deleteProduct(productId: string): Promise<DecisionResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) return { ok: false, error: "Product not found." };

  const everOrdered = await prisma.orderItem.findFirst({
    where: { productId },
    select: { id: true },
  });
  if (everOrdered) {
    return {
      ok: false,
      error: "This product has order history and cannot be deleted. Deactivate it instead.",
    };
  }

  await prisma.$transaction([
    prisma.productVariantValue.deleteMany({ where: { variant: { productId } } }),
    prisma.variantImage.deleteMany({ where: { variant: { productId } } }),
    prisma.cartItem.deleteMany({ where: { productId } }),
    prisma.sellerProductRequest.deleteMany({ where: { productId } }),
    prisma.dealOfTheDay.deleteMany({ where: { productId } }),
    prisma.wishlistItem.deleteMany({ where: { productId } }),
    prisma.productReview.deleteMany({ where: { productId } }),
    prisma.productComplianceReview.deleteMany({ where: { productId } }),
    prisma.merchandisingItem.deleteMany({ where: { productId } }),
    prisma.restockSubscription.deleteMany({ where: { productId } }),
    prisma.productImage.deleteMany({ where: { productId } }),
    prisma.productCustomerConfig.deleteMany({ where: { productId } }),
    prisma.productDealerConfig.deleteMany({ where: { productId } }),
    prisma.productVariant.deleteMany({ where: { productId } }),
    prisma.productVariantAttributeValue.deleteMany({ where: { productId } }),
    prisma.product.delete({ where: { id: productId } }),
  ]);

  return { ok: true };
}
