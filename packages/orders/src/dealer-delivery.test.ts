/**
 * Integration tests against the real dev Postgres. Creates its own
 * throwaway SellerProfile fixture — same convention as
 * phase4-security.test.ts.
 *
 * Dealer Transport pricing: always ₹0, for every seller, with no
 * configuration lookup at all — the dealer arranges and pays transport
 * privately, outside the platform, and the seller only ever prices dealer
 * variants exclusive of shipping (see charges.ts calculateSellerOrderCharges
 * doc comment). This replaced an earlier design where Transport priced off
 * a per-seller `ShippingMethod` row; that lookup (resolveDealerTransportCharge)
 * has been removed along with its "seller-specific rate wins over the
 * platform-wide default" behavior, since there is no rate to resolve
 * anymore. Dealer Kisan4U Courier is unaffected by this change.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { calculateSellerOrderCharges, determineChargeResponsibility } from "./charges";

const RUN = Date.now();
let sellerUserId: string;
let sellerProfileId: string;

before(async () => {
  const sellerUser = await prisma.user.create({
    data: {
      email: `test-transport-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Transport Seller",
      role: "SELLER",
      referralCode: `TESTTRN${RUN}`,
    },
  });
  sellerUserId = sellerUser.id;
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test Transport Shop ${RUN}`,
      slug: `test-transport-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerProfileId = sellerProfile.id;
});

after(async () => {
  await prisma.sellerProfile.delete({ where: { id: sellerProfileId } }).catch(() => {});
  await prisma.user.delete({ where: { id: sellerUserId } }).catch(() => {});
});

test("dealer Kisan4U Courier: dealer is the transportation payer", () => {
  assert.equal(
    determineChargeResponsibility("DEALER", "KISAN4U_COURIER").transportationPayer,
    "CUSTOMER",
  );
});

test("dealer Transport: nominally the dealer is the transportation payer, but the cost is always zero", () => {
  assert.equal(
    determineChargeResponsibility("DEALER", "TRANSPORT").transportationPayer,
    "CUSTOMER",
  );
});

test("dealer Kisan4U Courier order: dealer payable includes transportation, excludes collection charge", async () => {
  const result = await calculateSellerOrderCharges(1000, 3000, {
    customerType: "DEALER",
    deliveryMethod: "KISAN4U_COURIER",
    sellerId: sellerProfileId,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.customerPayableDelivery > 0, "dealer must pay the courier transportation cost");
  assert.equal(result.customerPayableDelivery, result.transportationCost);
  assert.equal(result.collectionChargePayer, "SELLER");
  assert.equal(result.sellerBorneAmount, result.collectionCharge); // transportation is NOT seller-borne here
});

test("dealer Transport order: shipping is always ₹0, no configuration required, seller still bears only the collection charge", async () => {
  const result = await calculateSellerOrderCharges(1000, 3000, {
    customerType: "DEALER",
    deliveryMethod: "TRANSPORT",
    sellerId: sellerProfileId,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.transportationCost, 0);
  assert.equal(result.customerPayableDelivery, 0);
  assert.equal(result.collectionChargePayer, "SELLER");
  assert.equal(result.sellerBorneAmount, result.collectionCharge);
});

test("dealer Transport order: still ₹0 even for a seller with no ShippingMethod configured at all", async () => {
  const freshSellerUser = await prisma.user.create({
    data: {
      email: `test-transport-no-config-${RUN}@example.com`,
      firstName: "TEST FIXTURE No Config Seller",
      role: "SELLER",
      referralCode: `TESTNCF${RUN}`,
    },
  });
  const freshSellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: freshSellerUser.id,
      shopName: `No Config Shop ${RUN}`,
      slug: `no-config-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  try {
    const result = await calculateSellerOrderCharges(1000, 3000, {
      customerType: "DEALER",
      deliveryMethod: "TRANSPORT",
      sellerId: freshSellerProfile.id,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.transportationCost, 0);
  } finally {
    await prisma.sellerProfile.delete({ where: { id: freshSellerProfile.id } });
    await prisma.user.delete({ where: { id: freshSellerUser.id } });
  }
});

test("customer order: transportation and collection charge are both seller-borne, customer payable delivery is zero", async () => {
  const result = await calculateSellerOrderCharges(1000, 3000, {
    customerType: "CUSTOMER",
    deliveryMethod: "KISAN4U_COURIER",
    sellerId: sellerProfileId,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.customerPayableDelivery, 0);
  assert.equal(result.transportationPayer, "SELLER");
  assert.equal(result.collectionChargePayer, "SELLER");
  assert.equal(result.sellerBorneAmount, result.transportationCost + result.collectionCharge);
});
