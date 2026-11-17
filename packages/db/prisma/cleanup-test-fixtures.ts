/**
 * One-off cleanup for orphaned "TEST FIXTURE ..." rows left behind by
 * integration test runs whose after() hook didn't get to run (an
 * interrupted run, a session-limit error mid-suite, etc.) — every test
 * fixture user in this repo's test files is named with that exact
 * "TEST FIXTURE" prefix specifically so a sweep like this can find them
 * safely, never touching real seeded demo data (seed.ts/seed-demo.ts
 * users are named things like "DEMO ..." or real-looking names, not
 * "TEST FIXTURE ..."). Deletes in FK-safe order, mirroring the same
 * sequence every test file's own after() hook already uses.
 */
import "dotenv/config";
import { prisma } from "../src/index";

async function main() {
  const users = await prisma.user.findMany({
    where: { name: { startsWith: "TEST FIXTURE" } },
    select: { id: true, name: true },
  });
  if (users.length === 0) {
    console.log("No orphaned TEST FIXTURE users found.");
    return;
  }
  const userIds = users.map((u) => u.id);
  console.log(`Found ${users.length} orphaned TEST FIXTURE user(s). Cleaning up...`);

  // Seller-side fixtures (some test files create a throwaway SellerProfile
  // too) — find any sellerId owned by one of these users so their orders
  // get cleaned even when the order's customerId isn't itself a fixture.
  const sellerProfiles = await prisma.sellerProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const sellerIds = sellerProfiles.map((s) => s.id);

  const sellerOrderWhere = {
    OR: [{ customerId: { in: userIds } }, { sellerId: { in: sellerIds } }],
  };

  await prisma.paymentAllocation.deleteMany({ where: { sellerOrder: sellerOrderWhere } });
  await prisma.paymentStatusHistory.deleteMany({
    where: { payment: { checkoutGroup: { customerId: { in: userIds } } } },
  });
  await prisma.payment.deleteMany({ where: { checkoutGroup: { customerId: { in: userIds } } } });
  await prisma.orderStatusHistory.deleteMany({ where: { sellerOrder: sellerOrderWhere } });
  await prisma.orderCharge.deleteMany({ where: { sellerOrder: sellerOrderWhere } });
  await prisma.orderItem.deleteMany({ where: { sellerOrder: sellerOrderWhere } });
  await prisma.sellerOrder.deleteMany({ where: sellerOrderWhere });
  const groups = await prisma.checkoutGroup.findMany({
    where: { customerId: { in: userIds } },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  await prisma.orderAddressSnapshot.deleteMany({ where: { checkoutGroupId: { in: groupIds } } });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: groupIds } } });

  await prisma.cartItem.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { sellerId: { in: sellerIds } }] },
  });
  await prisma.wishlistItem.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.customerAddress.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.productReview.deleteMany({ where: { customerId: { in: userIds } } });
  await prisma.refundRequest.deleteMany({ where: { customerId: { in: userIds } } });
  await prisma.couponRedemption.deleteMany({ where: { userId: { in: userIds } } });

  const wallets = await prisma.wallet.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);
  await prisma.walletTransaction.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });

  const dealerProfiles = await prisma.dealerProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const dealerProfileIds = dealerProfiles.map((d) => d.id);
  await prisma.sellerProductRequest.deleteMany({ where: { dealerId: { in: dealerProfileIds } } });
  await prisma.dealerProfile.deleteMany({ where: { id: { in: dealerProfileIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: { in: sellerIds } } });

  let deleted = 0;
  for (const id of userIds) {
    const result = await prisma.user.delete({ where: { id } }).catch(() => null);
    if (result) deleted++;
  }
  console.log(`Deleted ${deleted} of ${users.length} orphaned TEST FIXTURE user(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
