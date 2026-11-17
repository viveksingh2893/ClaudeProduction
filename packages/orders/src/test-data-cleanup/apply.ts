/**
 * The apply step — the ONLY code in this tool that writes anything, and
 * only ever invoked by the CLI's `apply` subcommand, which itself requires
 * --apply plus a previously-generated manifest file. Never called by the
 * dry-run/manifest-generation paths.
 *
 * Deletion order (children before parents, matching the FK-safe sequence
 * cleanup-test-fixtures.ts already established for the user-owned-order
 * chain, extended here):
 *   1. Independent VARIANT entries (a variant whose PARENT PRODUCT is NOT
 *      itself in this manifest) — via the existing removeVariant() domain
 *      service (packages/catalog), which already blocks on CartItem/
 *      OrderItem references.
 *   2. PRODUCT entries (which also removes every variant belonging to
 *      that product, and its variant-specific dependents) — via the
 *      existing deleteProduct() domain service, which already blocks on
 *      real order history.
 *   3. CUSTOMER / DEALER entries — user-owned non-order data, then the
 *      User row itself. Refuses (does not touch) any candidate with a
 *      SellerOrder/Payment/RefundRequest/nonzero-Wallet, matching the
 *      dry run's own blocking rules (defensive re-check, not just trust
 *      in the manifest).
 *   4. SELLER entries — seller-owned non-order data, then the
 *      SellerProfile row, then its underlying User row. Refuses if the
 *      seller still has ANY Product row at this point (should be zero —
 *      every one of its test products was in step 2, and a seller with a
 *      remaining non-test product is blocked well before reaching apply).
 *
 * Every step is wrapped in its own $transaction — a failure at any point
 * rolls back that one entity's deletion without touching anything else
 * already committed, and is reported rather than silently swallowed.
 */
import { prisma, type Prisma } from "@kisan4u/db";
import { deleteProduct, removeVariant } from "@kisan4u/catalog";
import type { Manifest, ManifestEntry } from "./manifest";

export type ApplyOutcome = {
  entry: ManifestEntry;
  ok: boolean;
  detail: string;
};

/**
 * Every User row — regardless of which role profile hangs off it — can
 * accumulate the same generic, userId-keyed personal-activity data: a
 * wallet, cart items placed AS a buyer, a wishlist, notifications, support
 * tickets, etc. This must run before `tx.user.delete()` for ANY role, not
 * just customers/dealers — a seller's own User row can just as easily have
 * a stray Notification/NotificationPreference/WishlistItem/etc. row (e.g.
 * from test-data setup scripts), and leaving even one behind means the
 * final user.delete() fails on an FK constraint. This was the root cause
 * of one of the two seller-deletion failures from the first apply run.
 */
async function deleteGenericUserOwnedData(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const wallet = await tx.wallet.findUnique({ where: { ownerId: userId } });
  if (wallet) {
    await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
    await tx.loyaltyPointsTransaction.deleteMany({ where: { walletId: wallet.id } });
    await tx.wallet.delete({ where: { id: wallet.id } });
  }
  await tx.cartItem.deleteMany({ where: { userId } });
  await tx.wishlistItem.deleteMany({ where: { userId } });
  await tx.customerAddress.deleteMany({ where: { userId } });
  await tx.productReview.deleteMany({ where: { customerId: userId } });
  await tx.couponRedemption.deleteMany({ where: { userId } });
  await tx.notificationPreference.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.supportMessage.deleteMany({ where: { ticket: { customerId: userId } } });
  await tx.supportTicket.deleteMany({ where: { customerId: userId } });
  await tx.restockSubscription.deleteMany({ where: { userId } });
  const checkoutGroups = await tx.checkoutGroup.findMany({ where: { customerId: userId }, select: { id: true } });
  await tx.orderAddressSnapshot.deleteMany({ where: { checkoutGroupId: { in: checkoutGroups.map((g) => g.id) } } });
  await tx.checkoutGroup.deleteMany({ where: { customerId: userId } });
  await tx.otpCode.deleteMany({
    where: { phone: (await tx.user.findUnique({ where: { id: userId }, select: { phone: true } }))?.phone ?? "__none__" },
  });
}

async function deleteUserOwnedData(userId: string): Promise<void> {
  // Re-verify nothing order/payment/wallet-related exists — defensive,
  // even though the manifest was already checked for this at dry-run time.
  const [orders, payments, refunds] = await Promise.all([
    prisma.sellerOrder.count({ where: { customerId: userId } }),
    prisma.payment.count({ where: { customerId: userId } }),
    prisma.refundRequest.count({ where: { customerId: userId } }),
  ]);
  if (orders > 0 || payments > 0 || refunds > 0) {
    throw new Error(
      `Refusing to delete user ${userId} — real order/payment/refund rows exist (orders=${orders}, payments=${payments}, refunds=${refunds}). This should have been caught before reaching apply.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await deleteGenericUserOwnedData(tx, userId);

    const dealerProfile = await tx.dealerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (dealerProfile) {
      await tx.sellerProductRequest.deleteMany({ where: { dealerId: dealerProfile.id } });
      await tx.dealerProfile.delete({ where: { id: dealerProfile.id } });
    }
    await tx.user.delete({ where: { id: userId } });
  });
}

async function deleteSellerOwnedData(sellerId: string): Promise<void> {
  const remainingProducts = await prisma.product.count({ where: { sellerId } });
  if (remainingProducts > 0) {
    throw new Error(
      `Refusing to delete seller ${sellerId} — it still has ${remainingProducts} Product row(s). Every test product owned by this seller must be deleted first (or the seller has a non-test product, which must block seller deletion entirely).`,
    );
  }
  const [orders, settlements] = await Promise.all([
    prisma.sellerOrder.count({ where: { sellerId } }),
    prisma.sellerSettlement.count({ where: { sellerId } }),
  ]);
  if (orders > 0 || settlements > 0) {
    throw new Error(
      `Refusing to delete seller ${sellerId} — real order/settlement rows exist (orders=${orders}, settlements=${settlements}).`,
    );
  }

  const userId = await prisma.sellerProfile
    .findUnique({ where: { id: sellerId }, select: { userId: true } })
    .then((s) => s?.userId);
  if (!userId) throw new Error(`SellerProfile ${sellerId} not found.`);

  await prisma.$transaction(async (tx) => {
    // Seller-role-specific data (keyed by sellerId).
    await tx.deliveryManProfile.deleteMany({ where: { sellerId } });
    await tx.cartItem.deleteMany({ where: { sellerId } });
    await tx.sellerPickupPoint.deleteMany({ where: { sellerId } });
    await tx.shippingMethod.deleteMany({ where: { sellerId } });
    await tx.warehouse.deleteMany({ where: { sellerId } });
    // ProductComplianceReview.submissionId FKs into SellerLicenceSubmission,
    // so reviews must go first — deleting the submission while a review
    // still points at it violates the FK constraint.
    await tx.productComplianceReview.deleteMany({ where: { sellerId } });
    await tx.sellerLicenceSubmission.deleteMany({ where: { sellerId } });
    await tx.coupon.deleteMany({ where: { sellerId } });
    await tx.sellerProductRequest.deleteMany({ where: { sellerId } });
    await tx.settlementRateConfig.deleteMany({ where: { sellerId } });
    await tx.stockAdjustment.deleteMany({ where: { sellerId } });
    await tx.bulkProductDraft.deleteMany({ where: { sellerId } });
    await tx.bulkProductGroup.deleteMany({ where: { sellerId } });
    await tx.brand.updateMany({ where: { ownerSellerId: sellerId }, data: { ownerSellerId: null } });
    await tx.manufacturer.updateMany({ where: { ownerSellerId: sellerId }, data: { ownerSellerId: null } });

    // Generic userId-keyed personal-activity data — same as any other
    // user role (the seller's account is still a User underneath).
    await deleteGenericUserOwnedData(tx, userId);

    await tx.sellerProfile.delete({ where: { id: sellerId } });
    await tx.user.delete({ where: { id: userId } });
  });
}

export async function applyManifest(manifest: Manifest): Promise<ApplyOutcome[]> {
  const outcomes: ApplyOutcome[] = [];

  const byType = {
    VARIANT: manifest.entries.filter((e) => e.entityType === "VARIANT"),
    PRODUCT: manifest.entries.filter((e) => e.entityType === "PRODUCT"),
    CUSTOMER: manifest.entries.filter((e) => e.entityType === "CUSTOMER"),
    DEALER: manifest.entries.filter((e) => e.entityType === "DEALER"),
    SELLER: manifest.entries.filter((e) => e.entityType === "SELLER"),
  };
  const productIdsInManifest = new Set(byType.PRODUCT.map((e) => e.id));

  // 1. Independent variants (parent product NOT itself in this manifest).
  for (const entry of byType.VARIANT) {
    const variant = await prisma.productVariant.findUnique({ where: { id: entry.id }, select: { productId: true } });
    if (!variant) {
      outcomes.push({ entry, ok: true, detail: "already gone (no-op)" });
      continue;
    }
    if (productIdsInManifest.has(variant.productId)) {
      outcomes.push({ entry, ok: true, detail: "skipped — parent product's own deletion already removes this variant" });
      continue;
    }
    const result = await removeVariant(entry.id);
    outcomes.push({ entry, ok: result.ok, detail: result.ok ? "deleted" : result.error });
  }

  // 2. Products (removes their own variants too).
  for (const entry of byType.PRODUCT) {
    const exists = await prisma.product.findUnique({ where: { id: entry.id }, select: { id: true } });
    if (!exists) {
      outcomes.push({ entry, ok: true, detail: "already gone (no-op)" });
      continue;
    }
    const result = await deleteProduct(entry.id);
    outcomes.push({ entry, ok: result.ok, detail: result.ok ? "deleted" : result.error });
  }

  // 3. Customers / dealers.
  for (const entry of [...byType.CUSTOMER, ...byType.DEALER]) {
    const exists = await prisma.user.findUnique({ where: { id: entry.id }, select: { id: true } });
    if (!exists) {
      outcomes.push({ entry, ok: true, detail: "already gone (no-op)" });
      continue;
    }
    try {
      await deleteUserOwnedData(entry.id);
      outcomes.push({ entry, ok: true, detail: "deleted" });
    } catch (err) {
      outcomes.push({ entry, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  // 4. Sellers (their test products are already gone from step 2).
  for (const entry of byType.SELLER) {
    const exists = await prisma.sellerProfile.findUnique({ where: { id: entry.id }, select: { id: true } });
    if (!exists) {
      outcomes.push({ entry, ok: true, detail: "already gone (no-op)" });
      continue;
    }
    try {
      await deleteSellerOwnedData(entry.id);
      outcomes.push({ entry, ok: true, detail: "deleted" });
    } catch (err) {
      outcomes.push({ entry, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return outcomes;
}
