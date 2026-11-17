import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Removes ONLY the records created by seed-demo.ts — every deletion below
 * is scoped to one of that script's stable markers (a `DEMO-`/`demo-`
 * prefix, a `demo.sellerN@kisan4u.local` email, or the `+9197/98000000##`
 * demo phone block). Never touches the foundational seed.ts fixtures, any
 * ad-hoc row created through manual testing, or real user data. Deletes in
 * FK-safe order (children before parents).
 *
 * Deliberately leaves the two new leaf categories (Clothing, Footwear) and
 * the backfilled Category.imageUrl values in place — those are ordinary
 * catalog/taxonomy data, not "demo business records," and removing a live
 * category out from under whatever else might reference it is not this
 * script's job. Delete them by hand from /admin/categories if you really
 * want them gone.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function assertSafeToDelete() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const nodeEnv = process.env.NODE_ENV ?? "";
  if (nodeEnv === "production") {
    throw new Error("Refusing to run seed-demo-cleanup.ts: NODE_ENV=production.");
  }
  const looksLocal = /localhost|127\.0\.0\.1/i.test(dbUrl);
  const looksLikeDevDb = /(_dev\b|dev_password|kisan4u_dev)/i.test(dbUrl);
  if (!looksLocal || !looksLikeDevDb) {
    throw new Error(
      "Refusing to run seed-demo-cleanup.ts: DATABASE_URL does not look like the local dev database.",
    );
  }
}

async function main() {
  assertSafeToDelete();

  const demoOrderNumberFilter = { orderNumber: { startsWith: "DEMO-" } } as const;
  const demoGroupNumberFilter = { groupNumber: { startsWith: "DEMO-" } } as const;
  const demoProductSkuFilter = { sku: { startsWith: "DEMO-" } } as const;
  const demoCustomerPhones = ["+919700000001", "+919700000002", "+919700000003"];
  const demoDealerPhones = ["+919800000001", "+919800000002", "+919800000003"];
  const demoSellerEmails = Array.from({ length: 9 }, (_, i) => `demo.seller${i + 1}@kisan4u.local`);

  const demoSellerOrders = await prisma.sellerOrder.findMany({
    where: demoOrderNumberFilter,
    select: { id: true, checkoutGroupId: true },
  });
  const sellerOrderIds = demoSellerOrders.map((o) => o.id);
  const checkoutGroupIds = [...new Set(demoSellerOrders.map((o) => o.checkoutGroupId))];

  const shipments = await prisma.shipment.findMany({
    where: { sellerOrderId: { in: sellerOrderIds } },
    select: { id: true },
  });
  await prisma.shipmentStatusHistory.deleteMany({
    where: { shipmentId: { in: shipments.map((s) => s.id) } },
  });
  await prisma.shipment.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });

  const payments = await prisma.payment.findMany({
    where: { checkoutGroupId: { in: checkoutGroupIds } },
    select: { id: true },
  });
  const paymentIds = payments.map((p) => p.id);
  await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });

  await prisma.orderStatusHistory.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });
  await prisma.orderCharge.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });

  // Reviews attached to a demo order's items must go before the items themselves.
  const orderItems = await prisma.orderItem.findMany({
    where: { sellerOrderId: { in: sellerOrderIds } },
    select: { id: true },
  });
  await prisma.productReview.deleteMany({
    where: { orderItemId: { in: orderItems.map((i) => i.id) } },
  });
  await prisma.orderItem.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });

  await prisma.sellerOrder.deleteMany({ where: demoOrderNumberFilter });
  await prisma.orderAddressSnapshot.deleteMany({
    where: { checkoutGroupId: { in: checkoutGroupIds } },
  });
  await prisma.checkoutGroup.deleteMany({ where: demoGroupNumberFilter });

  // Remaining demo reviews (manual/offline + any not caught above).
  const demoProducts = await prisma.product.findMany({
    where: demoProductSkuFilter,
    select: { id: true },
  });
  const demoProductIds = demoProducts.map((p) => p.id);
  await prisma.productReview.deleteMany({
    where: {
      OR: [
        { productId: { in: demoProductIds } },
        { manualCustomerName: { contains: "via call centre" } },
        { manualCustomerName: { contains: "via WhatsApp" } },
      ],
    },
  });

  // Cart items referencing demo products (none seeded, but a manual tester may have added one).
  await prisma.cartItem.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.wishlistItem.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.dealOfTheDay.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.merchandisingItem.deleteMany({ where: { productId: { in: demoProductIds } } });

  const variants = await prisma.productVariant.findMany({
    where: { productId: { in: demoProductIds } },
    select: { id: true },
  });
  await prisma.productVariantValue.deleteMany({
    where: { variantId: { in: variants.map((v) => v.id) } },
  });
  await prisma.productVariant.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.productVariantAttributeValue.deleteMany({
    where: { productId: { in: demoProductIds } },
  });
  await prisma.productImage.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.productDealerConfig.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.sellerProductRequest.deleteMany({ where: { productId: { in: demoProductIds } } });
  await prisma.product.deleteMany({ where: demoProductSkuFilter });

  // Customers (+ their addresses).
  const customerUsers = await prisma.user.findMany({
    where: { phone: { in: demoCustomerPhones } },
    select: { id: true },
  });
  const customerIds = customerUsers.map((u) => u.id);
  await prisma.customerAddress.deleteMany({ where: { userId: { in: customerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: customerIds } } });

  // Dealers.
  const dealerUsers = await prisma.user.findMany({
    where: { phone: { in: demoDealerPhones } },
    select: { id: true },
  });
  const dealerIds = dealerUsers.map((u) => u.id);
  await prisma.dealerProfile.deleteMany({ where: { userId: { in: dealerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: dealerIds } } });

  // Sellers (+ pickup points/licences, none seeded here, but scoped defensively).
  const sellerUsers = await prisma.user.findMany({
    where: { email: { in: demoSellerEmails } },
    select: { id: true },
  });
  const sellerProfiles = await prisma.sellerProfile.findMany({
    where: { userId: { in: sellerUsers.map((u) => u.id) } },
    select: { id: true, userId: true },
  });
  const sellerProfileIds = sellerProfiles.map((s) => s.id);
  await prisma.sellerPickupPoint.deleteMany({ where: { sellerId: { in: sellerProfileIds } } });
  await prisma.productComplianceReview.deleteMany({
    where: { sellerId: { in: sellerProfileIds } },
  });
  await prisma.sellerLicenceSubmission.deleteMany({
    where: { sellerId: { in: sellerProfileIds } },
  });
  await prisma.shippingMethod.deleteMany({ where: { sellerId: { in: sellerProfileIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: { in: sellerProfileIds } } });
  await prisma.user.deleteMany({ where: { id: { in: sellerUsers.map((u) => u.id) } } });

  // Brands / manufacturers.
  const brandResult = await prisma.brand.deleteMany({ where: { slug: { startsWith: "demo-" } } });
  const mfrResult = await prisma.manufacturer.deleteMany({
    where: { slug: { startsWith: "demo-" } },
  });

  console.log("\n=== Kisan4U demo seed data removed ===\n");
  console.table({
    sellerOrders: sellerOrderIds.length,
    checkoutGroups: checkoutGroupIds.length,
    products: demoProductIds.length,
    customers: customerIds.length,
    dealers: dealerIds.length,
    sellers: sellerProfileIds.length,
    brands: brandResult.count,
    manufacturers: mfrResult.count,
  });
  console.log(
    "Clothing/Footwear categories and any backfilled category images were left in place — see this file's doc comment.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
