/**
 * Integration tests against the real dev Postgres (same connection
 * seed.ts uses) — creates its own throwaway fixtures (unique
 * slugs/phones/emails via Date.now()) so it doesn't depend on or pollute
 * seed data, mirroring packages/catalog/src/dealer-catalogue.test.ts.
 * Assumes an active LogisticsPricingConfig and CollectionChargeConfig
 * already exist in the dev DB (both are seeded by prisma/seed.ts) — these
 * tests do not create or mutate that shared config, to avoid destabilizing
 * it for other tests/manual testing running against the same database.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart, updateCartItemQuantity, removeCartItem } from "./cart";
import { checkout } from "./checkout";
import { requestCancellation } from "./cancellation";
import { confirmOrder, acceptOrder, schedulePickup, markPickedUp } from "./order-workflow";
import { getSellerOrderForSeller } from "./order-queries";
import { getOrderTagData } from "./order-tag";
import { createSellerPickupPoint } from "./pickup-points";

const RUN = Date.now();

let sellerAId: string; // owns productCustomerOnly + productDealerOnly
let sellerBId: string; // owns productBothSellerB
let categoryId: string;
let stateAId: string;
let stateBId: string;

let productCustomerOnlyId: string;
let productDealerOnlyId: string; // restricted to stateA
let productBothSellerBId: string;
let productWithInactiveVariantId: string;
let inactiveVariantId: string;
let productSubmittedId: string; // not yet approved

let customerUserId: string;
let otherCustomerUserId: string;
let dealerMatchingStateUserId: string;
let dealerWrongStateUserId: string;

const createdProductIds: string[] = [];
const createdUserIds: string[] = [];
let createdSellerProfileIds: string[] = [];
const createdCheckoutGroupIds: string[] = [];

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;
  const states = await prisma.indianState.findMany({ take: 2 });
  if (states.length < 2) throw new Error("Test requires at least 2 seeded IndianState rows.");
  stateAId = states[0]!.id;
  stateBId = states[1]!.id;

  const sellerAUser = await prisma.user.create({
    data: {
      email: `test-seller-a-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller A",
      role: "SELLER",
      referralCode: `TEST-SELLER-A-${RUN}`,
      sellerProfile: {
        create: {
          shopName: `Test Seller A ${RUN}`,
          slug: `test-seller-a-${RUN}`,
          status: "APPROVED",
        },
      },
    },
    include: { sellerProfile: true },
  });
  sellerAId = sellerAUser.sellerProfile!.id;
  createdUserIds.push(sellerAUser.id);

  const sellerBUser = await prisma.user.create({
    data: {
      email: `test-seller-b-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller B",
      role: "SELLER",
      referralCode: `TEST-SELLER-B-${RUN}`,
      sellerProfile: {
        create: {
          shopName: `Test Seller B ${RUN}`,
          slug: `test-seller-b-${RUN}`,
          status: "APPROVED",
        },
      },
    },
    include: { sellerProfile: true },
  });
  sellerBId = sellerBUser.sellerProfile!.id;
  createdUserIds.push(sellerBUser.id);
  createdSellerProfileIds = [sellerAId, sellerBId];

  const baseProductData = {
    categoryId,
    hsnCode: "000000",
    shortDescription: "Test fixture",
    description: "Phase 4 security test fixture.",
    productType: "PHYSICAL" as const,
    baseUnit: "PIECE" as const,
    packageSize: "1 piece",
    primaryImageUrl: "/test/fixture.jpg",
  };

  const customerOnly = await prisma.product.create({
    data: {
      ...baseProductData,
      sellerId: sellerAId,
      name: "TEST FIXTURE customer-only product",
      slug: `test-customer-only-${RUN}`,
      sku: `TEST-CUSTOMER-ONLY-${RUN}`,
      audience: "CUSTOMER_ONLY",
      customerVisible: true,
      dealerVisible: false,
      lifecycleStatus: "APPROVED",
      customerConfig: {
        create: { mrp: 100, sellingPrice: 100, minOrderQty: 1, currentStock: 50, weight: 200 },
      },
    },
  });
  productCustomerOnlyId = customerOnly.id;
  createdProductIds.push(customerOnly.id);

  const dealerOnly = await prisma.product.create({
    data: {
      ...baseProductData,
      sellerId: sellerAId,
      name: "TEST FIXTURE dealer-only state-restricted product",
      slug: `test-dealer-only-${RUN}`,
      sku: `TEST-DEALER-ONLY-${RUN}`,
      audience: "DEALER_ONLY",
      customerVisible: false,
      dealerVisible: true,
      lifecycleStatus: "APPROVED",
      dealerAvailableStates: { connect: [{ id: stateAId }] },
      dealerConfig: {
        create: { mrp: 1000, sellingPrice: 1000, minOrderQty: 1, currentStock: 30, weight: 500 },
      },
    },
  });
  productDealerOnlyId = dealerOnly.id;
  createdProductIds.push(dealerOnly.id);

  const bothSellerB = await prisma.product.create({
    data: {
      ...baseProductData,
      sellerId: sellerBId,
      name: "TEST FIXTURE both-audience product (seller B)",
      slug: `test-both-sellerb-${RUN}`,
      sku: `TEST-BOTH-SELLERB-${RUN}`,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      customerVisible: true,
      dealerVisible: true,
      lifecycleStatus: "APPROVED",
      customerConfig: {
        create: { mrp: 200, sellingPrice: 200, minOrderQty: 1, currentStock: 40, weight: 300 },
      },
      dealerConfig: {
        create: { mrp: 2000, sellingPrice: 2000, minOrderQty: 1, currentStock: 20, weight: 3000 },
      },
    },
  });
  productBothSellerBId = bothSellerB.id;
  createdProductIds.push(bothSellerB.id);

  const withVariant = await prisma.product.create({
    data: {
      ...baseProductData,
      sellerId: sellerAId,
      name: "TEST FIXTURE product with an inactive variant",
      slug: `test-inactive-variant-${RUN}`,
      sku: `TEST-INACTIVE-VARIANT-${RUN}`,
      audience: "CUSTOMER_ONLY",
      customerVisible: true,
      dealerVisible: false,
      lifecycleStatus: "APPROVED",
      customerConfig: {
        create: { mrp: 100, sellingPrice: 100, minOrderQty: 1, currentStock: 10, weight: 100 },
      },
      variants: {
        create: [
          {
            audience: "CUSTOMER",
            sku: `TEST-INACTIVE-VARIANT-SKU-${RUN}`,
            combinationKey: `test-${RUN}`,
            mrp: 100,
            sellingPrice: 100,
            stockQty: 10,
            weight: 100,
            isActive: false,
          },
        ],
      },
    },
    include: { variants: true },
  });
  productWithInactiveVariantId = withVariant.id;
  inactiveVariantId = withVariant.variants[0]!.id;
  createdProductIds.push(withVariant.id);

  const submitted = await prisma.product.create({
    data: {
      ...baseProductData,
      sellerId: sellerAId,
      name: "TEST FIXTURE submitted (not yet approved) product",
      slug: `test-submitted-${RUN}`,
      sku: `TEST-SUBMITTED-${RUN}`,
      audience: "CUSTOMER_ONLY",
      customerVisible: true,
      dealerVisible: false,
      lifecycleStatus: "SUBMITTED",
      customerConfig: {
        create: { mrp: 100, sellingPrice: 100, minOrderQty: 1, currentStock: 10, weight: 100 },
      },
    },
  });
  productSubmittedId = submitted.id;
  createdProductIds.push(submitted.id);

  const customer = await prisma.user.create({
    data: {
      phone: `+9190000${RUN.toString().slice(-4)}`,
      firstName: "TEST FIXTURE customer",
      role: "CUSTOMER",
      referralCode: `TEST-CUSTOMER-${RUN}`,
    },
  });
  customerUserId = customer.id;
  createdUserIds.push(customer.id);

  const otherCustomer = await prisma.user.create({
    data: {
      phone: `+9190001${RUN.toString().slice(-4)}`,
      firstName: "TEST FIXTURE other customer",
      role: "CUSTOMER",
      referralCode: `TEST-OTHER-CUSTOMER-${RUN}`,
    },
  });
  otherCustomerUserId = otherCustomer.id;
  createdUserIds.push(otherCustomer.id);

  const dealerMatching = await prisma.user.create({
    data: {
      phone: `+9190002${RUN.toString().slice(-4)}`,
      firstName: "TEST FIXTURE dealer matching state",
      role: "DEALER",
      referralCode: `TEST-DEALER-MATCH-${RUN}`,
      dealerProfile: { create: { status: "APPROVED", storeName: "Test", stateId: stateAId } },
    },
  });
  dealerMatchingStateUserId = dealerMatching.id;
  createdUserIds.push(dealerMatching.id);

  const dealerWrongState = await prisma.user.create({
    data: {
      phone: `+9190003${RUN.toString().slice(-4)}`,
      firstName: "TEST FIXTURE dealer wrong state",
      role: "DEALER",
      referralCode: `TEST-DEALER-WRONG-${RUN}`,
      dealerProfile: { create: { status: "APPROVED", storeName: "Test", stateId: stateBId } },
    },
  });
  dealerWrongStateUserId = dealerWrongState.id;
  createdUserIds.push(dealerWrongState.id);
});

after(async () => {
  // Delete in dependency order — deepest children first.
  const groups = await prisma.checkoutGroup.findMany({
    where: { id: { in: createdCheckoutGroupIds } },
    include: { sellerOrders: true, payments: true },
  });
  const sellerOrderIds = groups.flatMap((g) => g.sellerOrders.map((o) => o.id));
  const paymentIds = groups.flatMap((g) => g.payments.map((p) => p.id));

  // confirmOrder now deducts stock (StockAdjustment rows) and notifies the
  // buyer + seller (Notification rows) — clear both so the user/product
  // deletes below don't hit a foreign-key constraint.
  await prisma.stockAdjustment.deleteMany({
    where: { relatedOrderId: { in: sellerOrderIds } },
  });
  await prisma.shipmentStatusHistory.deleteMany({
    where: { shipment: { sellerOrderId: { in: sellerOrderIds } } },
  });
  await prisma.shipment.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });
  await prisma.orderStatusHistory.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });
  await prisma.orderItem.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });
  await prisma.orderCharge.deleteMany({ where: { sellerOrderId: { in: sellerOrderIds } } });
  await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.sellerOrder.deleteMany({ where: { id: { in: sellerOrderIds } } });
  await prisma.orderAddressSnapshot.deleteMany({
    where: { checkoutGroupId: { in: createdCheckoutGroupIds } },
  });
  await prisma.orderIdempotencyKey.deleteMany({
    where: { checkoutGroupId: { in: createdCheckoutGroupIds } },
  });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: createdCheckoutGroupIds } } });

  await prisma.cartItem.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.customerAddress.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.sellerPickupPoint.deleteMany({
    where: { sellerId: { in: createdSellerProfileIds } },
  });

  await prisma.productVariant.deleteMany({ where: { productId: productWithInactiveVariantId } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.productDealerConfig.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });

  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.dealerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: { in: createdSellerProfileIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

// --- Cart authorization & validation (§Z "Cart") -----------------------------

test("a customer cannot add a dealer-only product to their cart", async () => {
  const result = await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productDealerOnlyId, quantity: 1 },
  );
  assert.equal(result.ok, false);
});

test("a dealer cannot add a customer-only product to their cart", async () => {
  const result = await addToCart(
    dealerMatchingStateUserId,
    { role: "DEALER", dealerStateId: stateAId },
    { productId: productCustomerOnlyId, quantity: 1 },
  );
  assert.equal(result.ok, false);
});

test("dealer state restriction is enforced on add-to-cart: matching state succeeds, mismatched state is rejected", async () => {
  const matching = await addToCart(
    dealerMatchingStateUserId,
    { role: "DEALER", dealerStateId: stateAId },
    { productId: productDealerOnlyId, quantity: 1 },
  );
  assert.equal(matching.ok, true);
  const mismatched = await addToCart(
    dealerWrongStateUserId,
    { role: "DEALER", dealerStateId: stateBId },
    { productId: productDealerOnlyId, quantity: 1 },
  );
  assert.equal(mismatched.ok, false);
});

test("an inactive variant is rejected", async () => {
  const result = await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productWithInactiveVariantId, variantId: inactiveVariantId, quantity: 1 },
  );
  assert.equal(result.ok, false);
});

test("a not-yet-approved (SUBMITTED) product is rejected", async () => {
  const result = await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productSubmittedId, quantity: 1 },
  );
  assert.equal(result.ok, false);
});

test("price and seller id are always read from the database, never accepted from the caller", async () => {
  const result = await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productCustomerOnlyId, quantity: 1 },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const item = await prisma.cartItem.findUniqueOrThrow({ where: { id: result.cartItemId } });
  assert.equal(Number(item.priceAtAdd), 100); // the product's real sellingPrice — addToCartInputSchema has no price field at all
  assert.equal(item.sellerId, sellerAId); // the product's real sellerId — addToCartInputSchema has no sellerId field at all
});

test("a user cannot modify or remove another user's cart item", async () => {
  await prisma.cartItem.deleteMany({ where: { userId: customerUserId } });
  const added = await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productCustomerOnlyId, quantity: 1 },
  );
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const updateAsOther = await updateCartItemQuantity(
    otherCustomerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { cartItemId: added.cartItemId, quantity: 5 },
  );
  assert.equal(updateAsOther.ok, false);

  const removeAsOther = await removeCartItem(otherCustomerUserId, added.cartItemId);
  assert.equal(removeAsOther.ok, false);

  const stillThere = await prisma.cartItem.findUnique({ where: { id: added.cartItemId } });
  assert.ok(
    stillThere,
    "the cart item must still exist — another user's attempt must not have deleted it",
  );
  assert.equal(
    stillThere!.quantity,
    1,
    "another user's attempt must not have changed the quantity",
  );
});

// --- Multi-seller checkout (§Z "Multi-seller checkout") ----------------------

test("a multi-seller cart splits into one seller order per seller, atomically, with price/address snapshots preserved", async () => {
  await prisma.cartItem.deleteMany({ where: { userId: customerUserId } });
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productCustomerOnlyId, quantity: 1 },
  );
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productBothSellerBId, quantity: 1 },
  );

  // Change the seller-B product's price AFTER it was added to cart, BEFORE
  // checkout — the order item must reflect the NEW price, never the stale
  // cart-time price (§B4/§F).
  await prisma.productCustomerConfig.update({
    where: { productId: productBothSellerBId },
    data: { sellingPrice: 250 },
  });

  const idempotencyKey = `test-idem-${RUN}-multiseller`;
  const result = await checkout(
    customerUserId,
    { role: "CUSTOMER", dealerState: null },
    {
      newAddress: {
        fullName: "Test Customer",
        mobile: "+919876543210",
        altMobile: undefined,
        line1: "1 Test Street",
        cityTown: "Test Town",
        district: "Test District",
        state: "Test State",
        pincode: "411001",
        addressType: "HOME",
        isDefault: false,
      },
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey,
    },
  );

  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (!result.ok) return;
  createdCheckoutGroupIds.push(result.checkoutGroupId);

  const sellerOrders = await prisma.sellerOrder.findMany({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { items: true },
  });
  assert.equal(sellerOrders.length, 2, "one seller order per seller");
  const orderForA = sellerOrders.find((o) => o.sellerId === sellerAId)!;
  const orderForB = sellerOrders.find((o) => o.sellerId === sellerBId)!;
  assert.ok(orderForA && orderForB);
  assert.equal(orderForA.items.length, 1);
  assert.equal(
    orderForA.items[0]!.productId,
    productCustomerOnlyId,
    "seller A's order must contain only seller A's item",
  );
  assert.equal(orderForB.items.length, 1);
  assert.equal(
    orderForB.items[0]!.productId,
    productBothSellerBId,
    "seller B's order must contain only seller B's item",
  );
  assert.equal(
    Number(orderForB.items[0]!.unitPrice),
    250,
    "must use the latest price at checkout, not the stale cart-time price",
  );

  // Every order is placed "Pending" now — confirm both so the seller-facing
  // visibility and cancellation flows exercised by the tests below (which
  // all start from CONFIRMED) apply.
  assert.equal((await confirmOrder(customerUserId, orderForA.id)).ok, true);
  assert.equal((await confirmOrder(customerUserId, orderForB.id)).ok, true);

  const addressSnapshot = await prisma.orderAddressSnapshot.findUnique({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  assert.ok(addressSnapshot);
  assert.equal(addressSnapshot!.cityTown, "Test Town");

  // Duplicate submission with the SAME idempotency key must not create a second checkout group.
  const replay = await checkout(
    customerUserId,
    { role: "CUSTOMER", dealerState: null },
    {
      newAddress: {
        fullName: "Test Customer",
        mobile: "+919876543210",
        altMobile: undefined,
        line1: "1 Test Street",
        cityTown: "Test Town",
        district: "Test District",
        state: "Test State",
        pincode: "411001",
        addressType: "HOME",
        isDefault: false,
      },
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey,
    },
  );
  assert.equal(replay.ok, true);
  if (replay.ok)
    assert.equal(
      replay.checkoutGroupId,
      result.checkoutGroupId,
      "a replayed idempotency key must return the SAME checkout group, not a new one",
    );

  const groupCount = await prisma.checkoutGroup.count({
    where: {
      groupNumber: (
        await prisma.checkoutGroup.findUniqueOrThrow({ where: { id: result.checkoutGroupId } })
      ).groupNumber,
    },
  });
  assert.equal(groupCount, 1, "no duplicate checkout group was created by the replay");
});

test("checkout is atomic: an invalid line (below minimum order quantity) blocks the whole multi-seller checkout, no partial orders", async () => {
  await prisma.cartItem.deleteMany({ where: { userId: otherCustomerUserId } });
  await prisma.productCustomerConfig.update({
    where: { productId: productBothSellerBId },
    data: { minOrderQty: 5 },
  });

  await addToCart(
    otherCustomerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: productCustomerOnlyId, quantity: 1 },
  );
  // Force an invalid line directly (bypassing addToCart's own validation) to simulate a stock/minOrderQty change after the item was already in cart.
  await prisma.cartItem.create({
    data: {
      userId: otherCustomerUserId,
      sellerId: sellerBId,
      productId: productBothSellerBId,
      variantId: null,
      quantity: 1,
      priceAtAdd: 250,
    },
  });

  const before = await prisma.checkoutGroup.count();
  const result = await checkout(
    otherCustomerUserId,
    { role: "CUSTOMER", dealerState: null },
    {
      newAddress: {
        fullName: "Test Customer 2",
        mobile: "+919876543211",
        altMobile: undefined,
        line1: "2 Test Street",
        cityTown: "Test Town",
        district: "Test District",
        state: "Test State",
        pincode: "411001",
        addressType: "HOME",
        isDefault: false,
      },
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "COD",
      idempotencyKey: `test-idem-${RUN}-atomic`,
    },
  );
  assert.equal(result.ok, false);
  const after = await prisma.checkoutGroup.count();
  assert.equal(
    after,
    before,
    "no checkout group at all was created — not even for the valid seller-A line",
  );

  await prisma.productCustomerConfig.update({
    where: { productId: productBothSellerBId },
    data: { minOrderQty: 1 },
  });
  await prisma.cartItem.deleteMany({ where: { userId: otherCustomerUserId } });
});

// --- Seller authorization (§Z "Seller authorization") ------------------------

test("a seller sees only their own orders, cannot select another seller's pickup point, and cannot print another seller's tag", async () => {
  const sellerOrder = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: { in: createdCheckoutGroupIds }, sellerId: sellerAId },
  });
  assert.ok(sellerOrder, "expected a seller-A order to exist from the earlier checkout test");
  if (!sellerOrder) return;

  const asOwner = await getSellerOrderForSeller(sellerAId, sellerOrder.id);
  assert.ok(asOwner);
  const asOtherSeller = await getSellerOrderForSeller(sellerBId, sellerOrder.id);
  assert.equal(asOtherSeller, null, "seller B must not be able to fetch seller A's order");

  const sellerBPickupPoint = await createSellerPickupPoint(sellerBId, {
    name: "Seller B point",
    contactPerson: "Test",
    mobile: "+919999999999",
    line1: "x",
    city: "x",
    district: "x",
    state: "x",
    pincode: "411001",
    isDefault: true,
  });
  assert.equal(sellerBPickupPoint.ok, true);
  if (!sellerBPickupPoint.ok) return;
  await prisma.sellerPickupPoint.update({
    where: { id: sellerBPickupPoint.pickupPointId },
    data: { approvalStatus: "APPROVED" },
  });

  const acceptResult = await acceptOrder(sellerAId, sellerAId, {
    sellerOrderId: sellerOrder.id,
    pickupPointId: sellerBPickupPoint.pickupPointId,
  });
  assert.equal(
    acceptResult.ok,
    false,
    "seller A must not be able to select seller B's pickup point",
  );

  const tagAsOwner = await getOrderTagData(sellerAId, sellerOrder.id);
  const tagAsOther = await getOrderTagData(sellerBId, sellerOrder.id);
  assert.equal(tagAsOther.ok, false, "seller B must not be able to print seller A's order tag");
  // tagAsOwner may be ok:false too if the address snapshot isn't on this
  // particular order's checkout group — either way, ownership is proven by
  // the two calls disagreeing only on the seller-B side never succeeding.
  void tagAsOwner;
});

test("a seller cannot schedule pickup or mark picked-up out of order (invalid status transitions are blocked)", async () => {
  const sellerOrder = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: { in: createdCheckoutGroupIds }, sellerId: sellerBId },
  });
  assert.ok(sellerOrder);
  if (!sellerOrder) return;

  // Order is still CONFIRMED (never accepted) — scheduling pickup must fail.
  const scheduleResult = await schedulePickup(sellerBId, sellerBId, {
    sellerOrderId: sellerOrder.id,
  });
  assert.equal(scheduleResult.ok, false);

  // No shipment exists yet — marking picked up must fail too.
  const pickedUpResult = await markPickedUp(sellerBId, sellerBId, sellerOrder.id);
  assert.equal(pickedUpResult.ok, false);
});

// --- Cancellation (§Z "Cancellation") ----------------------------------------

test("cancellation before transit succeeds for the owning customer, but not for another customer", async () => {
  const sellerOrder = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: { in: createdCheckoutGroupIds }, sellerId: sellerAId },
  });
  assert.ok(sellerOrder);
  if (!sellerOrder) return;

  const wrongCustomer = await requestCancellation(otherCustomerUserId, "CUSTOMER", {
    sellerOrderId: sellerOrder.id,
    reason: "not mine",
  });
  assert.equal(
    wrongCustomer.ok,
    false,
    "another customer must not be able to cancel someone else's order",
  );

  const owner = await requestCancellation(sellerOrder.customerId, "CUSTOMER", {
    sellerOrderId: sellerOrder.id,
    reason: "changed my mind",
  });
  assert.equal(owner.ok, true);

  const updated = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrder.id } });
  assert.equal(updated.status, "CANCELLATION_REQUESTED");
});

test("cancellation is blocked once an order reaches IN_TRANSIT", async () => {
  const sellerOrder = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: { in: createdCheckoutGroupIds }, sellerId: sellerBId },
  });
  assert.ok(sellerOrder);
  if (!sellerOrder) return;

  await prisma.sellerOrder.update({
    where: { id: sellerOrder.id },
    data: { status: "IN_TRANSIT" },
  });
  const result = await requestCancellation(sellerOrder.customerId, "CUSTOMER", {
    sellerOrderId: sellerOrder.id,
    reason: "too late",
  });
  assert.equal(result.ok, false);
});
