/**
 * For each candidate, counts every dependent record this repo's schema
 * actually has, and decides whether that candidate is BLOCKED from
 * automatic deletion. The blocking rule, applied uniformly: any real
 * transactional history (an order, a payment, a settlement, a refund, a
 * wallet with a nonzero balance or any transaction) blocks deletion —
 * deliberately even when the counterpart on that record is ALSO a test
 * entity, because "historical orders, invoices, payments, settlements,
 * refunds, and payouts must not be silently removed" (spec §4) is safest
 * read as an absolute rule, not one that only applies cross-boundary.
 */
import { prisma } from "@kisan4u/db";
import type { Candidate, DependentCount } from "./types";

function nz(counts: DependentCount[]): DependentCount[] {
  return counts.filter((c) => c.count > 0);
}

// ---------------------------------------------------------------------------
// Customer / Dealer (both are User rows — same dependency shape, only the
// order-side field differs: customerId for a buyer, same field name for a
// dealer since a dealer is also just a User placing orders as `role: DEALER`).
// ---------------------------------------------------------------------------

export async function analyzeUserDependencies(
  candidate: Candidate,
  testSellerIds: Set<string>,
): Promise<void> {
  const userId = candidate.id;

  const [
    addresses,
    cartItems,
    wishlistItems,
    checkoutGroupsAsBuyer,
    posCheckoutsPlaced,
    sellerOrdersAsBuyer,
    payments,
    productReviews,
    refundRequests,
    couponRedemptions,
    notificationPrefs,
    notifications,
    supportTickets,
    restockSubscriptions,
    wallet,
  ] = await Promise.all([
    prisma.customerAddress.count({ where: { userId } }),
    prisma.cartItem.count({ where: { userId } }),
    prisma.wishlistItem.count({ where: { userId } }),
    prisma.checkoutGroup.count({ where: { customerId: userId } }),
    prisma.checkoutGroup.count({ where: { placedByUserId: userId } }),
    prisma.sellerOrder.findMany({
      where: { customerId: userId },
      select: { id: true, sellerId: true, seller: { select: { shopName: true } } },
    }),
    prisma.payment.count({ where: { customerId: userId } }),
    prisma.productReview.findMany({
      where: { customerId: userId },
      select: { id: true, orderItemId: true, productId: true },
    }),
    prisma.refundRequest.count({ where: { customerId: userId } }),
    prisma.couponRedemption.count({ where: { userId } }),
    prisma.notificationPreference.count({ where: { userId } }),
    prisma.notification.count({ where: { userId } }),
    prisma.supportTicket.count({ where: { customerId: userId } }),
    prisma.restockSubscription.count({ where: { userId } }),
    prisma.wallet.findUnique({ where: { ownerId: userId } }),
  ]);

  candidate.dependents = nz([
    { table: "CustomerAddress", count: addresses },
    { table: "CartItem", count: cartItems },
    { table: "WishlistItem", count: wishlistItems },
    { table: "CheckoutGroup (as buyer)", count: checkoutGroupsAsBuyer },
    { table: "CheckoutGroup (placed via POS by this account)", count: posCheckoutsPlaced },
    { table: "SellerOrder (as buyer)", count: sellerOrdersAsBuyer.length },
    { table: "Payment", count: payments },
    { table: "ProductReview", count: productReviews.length },
    { table: "RefundRequest", count: refundRequests },
    { table: "CouponRedemption", count: couponRedemptions },
    { table: "NotificationPreference", count: notificationPrefs },
    { table: "Notification", count: notifications },
    { table: "SupportTicket", count: supportTickets },
    { table: "RestockSubscription", count: restockSubscriptions },
    { table: "Wallet", count: wallet ? 1 : 0 },
  ]);

  if (sellerOrdersAsBuyer.length > 0) {
    candidate.blockReasons.push(
      `Has ${sellerOrdersAsBuyer.length} real SellerOrder row(s) as buyer — order history is never auto-deleted.`,
    );
    const nonTestSellerOrders = sellerOrdersAsBuyer.filter((o) => !testSellerIds.has(o.sellerId));
    if (nonTestSellerOrders.length > 0) {
      candidate.linkedToApparentlyRealData = true;
      candidate.linkedToApparentlyRealDataDetail = `${nonTestSellerOrders.length} order(s) placed with a non-test seller: ${nonTestSellerOrders
        .map((o) => o.seller.shopName)
        .join(", ")}`;
    }
  }
  if (posCheckoutsPlaced > 0) {
    candidate.blockReasons.push(
      `Placed ${posCheckoutsPlaced} order(s) via POS on someone else's behalf — real order-placement history.`,
    );
  }
  if (payments > 0) {
    candidate.blockReasons.push(`Has ${payments} real Payment row(s) — never auto-deleted.`);
  }
  if (refundRequests > 0) {
    candidate.blockReasons.push(`Has ${refundRequests} real RefundRequest row(s) — never auto-deleted.`);
  }
  if (wallet && (Number(wallet.balance) !== 0 || Number(wallet.pendingWithdraw) !== 0 || Number(wallet.cashInHand) !== 0)) {
    candidate.blockReasons.push(
      `Wallet has a nonzero balance/pending-withdraw/cash-in-hand (₹${wallet.balance}/₹${wallet.pendingWithdraw}/₹${wallet.cashInHand}) — never auto-deleted.`,
    );
  } else if (wallet) {
    const [walletTx, loyaltyTx] = await Promise.all([
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
      prisma.loyaltyPointsTransaction.count({ where: { walletId: wallet.id } }),
    ]);
    if (walletTx > 0 || loyaltyTx > 0) {
      candidate.blockReasons.push(
        `Wallet has ${walletTx} transaction(s) and ${loyaltyTx} loyalty-points entr(y/ies) in its ledger — never auto-deleted, even at a zero current balance.`,
      );
    }
  }
  const verifiedReviews = productReviews.filter((r) => r.orderItemId != null);
  if (verifiedReviews.length > 0) {
    candidate.blockReasons.push(
      `Has ${verifiedReviews.length} verified-purchase ProductReview(s) tied to a real OrderItem — never auto-deleted.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sellers
// ---------------------------------------------------------------------------

export async function analyzeSellerDependencies(candidate: Candidate): Promise<{ productIds: string[] }> {
  const sellerId = candidate.id;

  const [
    products,
    cartItems,
    sellerOrders,
    pickupPoints,
    shippingMethods,
    deliveryMen,
    warehouses,
    licenceSubmissions,
    complianceReviews,
    coupons,
    ownedBrands,
    ownedManufacturers,
    productRequestsAsSeller,
    settlementRateConfigs,
    settlements,
    stockAdjustments,
    bulkProductDrafts,
    bulkProductGroups,
    wallet,
  ] = await Promise.all([
    prisma.product.findMany({ where: { sellerId }, select: { id: true } }),
    prisma.cartItem.count({ where: { sellerId } }),
    prisma.sellerOrder.findMany({
      where: { sellerId },
      select: { id: true, customerId: true, customer: { select: { role: true, firstName: true, lastName: true } } },
    }),
    prisma.sellerPickupPoint.count({ where: { sellerId } }),
    prisma.shippingMethod.count({ where: { sellerId } }),
    prisma.deliveryManProfile.count({ where: { sellerId } }),
    prisma.warehouse.count({ where: { sellerId } }),
    prisma.sellerLicenceSubmission.count({ where: { sellerId } }),
    prisma.productComplianceReview.count({ where: { sellerId } }),
    prisma.coupon.count({ where: { sellerId } }),
    prisma.brand.count({ where: { ownerSellerId: sellerId } }),
    prisma.manufacturer.count({ where: { ownerSellerId: sellerId } }),
    prisma.sellerProductRequest.count({ where: { sellerId } }),
    prisma.settlementRateConfig.count({ where: { sellerId } }),
    prisma.sellerSettlement.count({ where: { sellerId } }),
    prisma.stockAdjustment.count({ where: { sellerId } }),
    prisma.bulkProductDraft.count({ where: { sellerId } }),
    prisma.bulkProductGroup.count({ where: { sellerId } }),
    prisma.wallet.findUnique({ where: { ownerId: sellerId } }),
  ]);

  const productIds = products.map((p) => p.id);

  candidate.dependents = nz([
    { table: "Product", count: products.length },
    { table: "CartItem", count: cartItems },
    { table: "SellerOrder", count: sellerOrders.length },
    { table: "SellerPickupPoint", count: pickupPoints },
    { table: "ShippingMethod", count: shippingMethods },
    { table: "DeliveryManProfile", count: deliveryMen },
    { table: "Warehouse", count: warehouses },
    { table: "SellerLicenceSubmission", count: licenceSubmissions },
    { table: "ProductComplianceReview", count: complianceReviews },
    { table: "Coupon", count: coupons },
    { table: "Brand (owned)", count: ownedBrands },
    { table: "Manufacturer (owned)", count: ownedManufacturers },
    { table: "SellerProductRequest (as seller)", count: productRequestsAsSeller },
    { table: "SettlementRateConfig", count: settlementRateConfigs },
    { table: "SellerSettlement", count: settlements },
    { table: "StockAdjustment", count: stockAdjustments },
    { table: "BulkProductDraft", count: bulkProductDrafts },
    { table: "BulkProductGroup", count: bulkProductGroups },
    { table: "Wallet", count: wallet ? 1 : 0 },
  ]);

  if (sellerOrders.length > 0) {
    candidate.blockReasons.push(
      `Has ${sellerOrders.length} real SellerOrder row(s) as seller — order history is never auto-deleted.`,
    );
  }
  if (settlements > 0) {
    candidate.blockReasons.push(`Has ${settlements} SellerSettlement row(s) — never auto-deleted.`);
  }
  if (wallet && (Number(wallet.balance) !== 0 || Number(wallet.pendingWithdraw) !== 0)) {
    candidate.blockReasons.push(
      `Wallet has a nonzero balance/pending-withdraw (₹${wallet.balance}/₹${wallet.pendingWithdraw}) — never auto-deleted.`,
    );
  }
  if (ownedBrands > 0 || ownedManufacturers > 0) {
    candidate.blockReasons.push(
      `Owns ${ownedBrands} Brand(s) and ${ownedManufacturers} Manufacturer(s) — per spec, brands/manufacturers are only removed if independently confirmed as test records and explicitly approved, never bundled into a seller deletion automatically.`,
    );
  }
  if (deliveryMen > 0) {
    candidate.blockReasons.push(
      `Has ${deliveryMen} DeliveryManProfile row(s) — a delivery-man account is itself a User row this tool does not evaluate; needs manual review.`,
    );
  }

  return { productIds };
}

// ---------------------------------------------------------------------------
// Products / Variants
// ---------------------------------------------------------------------------

export async function analyzeProductDependencies(candidate: Candidate): Promise<void> {
  const productId = candidate.id;

  const [
    variants,
    images,
    reviews,
    cartItems,
    wishlistItems,
    dealsOfTheDay,
    merchandisingItems,
    complianceReviews,
    stockAdjustments,
    restockSubscriptions,
    productRequests,
    orderItems,
  ] = await Promise.all([
    prisma.productVariant.count({ where: { productId } }),
    prisma.productImage.count({ where: { productId } }),
    prisma.productReview.findMany({ where: { productId }, select: { id: true, orderItemId: true } }),
    prisma.cartItem.count({ where: { productId } }),
    prisma.wishlistItem.count({ where: { productId } }),
    prisma.dealOfTheDay.count({ where: { productId } }),
    prisma.merchandisingItem.count({ where: { productId } }),
    prisma.productComplianceReview.count({ where: { productId } }),
    prisma.stockAdjustment.count({ where: { productId } }),
    prisma.restockSubscription.count({ where: { productId } }),
    prisma.sellerProductRequest.count({ where: { productId } }),
    // OrderItem.productId is informational (no real FK — see its schema
    // doc comment), so this is a plain string match, same as
    // deleteProduct's own "everOrdered" check.
    prisma.orderItem.count({ where: { productId } }),
  ]);

  candidate.dependents = nz([
    { table: "ProductVariant", count: variants },
    { table: "ProductImage", count: images },
    { table: "ProductReview", count: reviews.length },
    { table: "CartItem", count: cartItems },
    { table: "WishlistItem", count: wishlistItems },
    { table: "DealOfTheDay", count: dealsOfTheDay },
    { table: "MerchandisingItem", count: merchandisingItems },
    { table: "ProductComplianceReview", count: complianceReviews },
    { table: "StockAdjustment", count: stockAdjustments },
    { table: "RestockSubscription", count: restockSubscriptions },
    { table: "SellerProductRequest", count: productRequests },
    { table: "OrderItem (ever ordered)", count: orderItems },
  ]);

  if (orderItems > 0) {
    candidate.blockReasons.push(
      `Has ${orderItems} real OrderItem row(s) — this product has been ordered; matches deleteProduct's own existing guard ("has order history and cannot be deleted").`,
    );
  }
  const verifiedReviews = reviews.filter((r) => r.orderItemId != null);
  if (verifiedReviews.length > 0 && orderItems === 0) {
    // Belt-and-suspenders — a verified review implies an order exists, so
    // this should be unreachable given the orderItems check above, but
    // surfaced explicitly rather than silently relying on that inference.
    candidate.blockReasons.push(`Has ${verifiedReviews.length} verified-purchase review(s).`);
  }
}

export async function analyzeVariantDependencies(candidate: Candidate): Promise<void> {
  const variantId = candidate.id;
  // No WishlistItem check — wishlisting is product-level only in this
  // schema (WishlistItem has no variantId column), unlike CartItem.
  const [cartItems, stockAdjustments, restockSubscriptions, productRequests, orderItems, reviews] =
    await Promise.all([
      prisma.cartItem.count({ where: { variantId } }),
      prisma.stockAdjustment.count({ where: { variantId } }),
      prisma.restockSubscription.count({ where: { variantId } }),
      prisma.sellerProductRequest.count({ where: { variantId } }),
      prisma.orderItem.count({ where: { variantId } }),
      prisma.productReview.count({ where: { orderItem: { variantId } } }),
    ]);

  candidate.dependents = nz([
    { table: "CartItem", count: cartItems },
    { table: "StockAdjustment", count: stockAdjustments },
    { table: "RestockSubscription", count: restockSubscriptions },
    { table: "SellerProductRequest", count: productRequests },
    { table: "OrderItem (ever ordered)", count: orderItems },
    { table: "ProductReview (via order)", count: reviews },
  ]);

  if (orderItems > 0) {
    candidate.blockReasons.push(`Has ${orderItems} real OrderItem row(s) — this variant has been ordered.`);
  }
}
