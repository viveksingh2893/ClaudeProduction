/**
 * Integration tests against the real dev Postgres — same throwaway-fixture
 * convention as transport-note.test.ts / dealer-add-to-cart.test.ts.
 * Covers the Kisan4U Wallet requirements: dealer balance + deduction,
 * a request that exceeds the available balance (capped, not rejected),
 * a failed remaining-charge attempt rolling the wallet debit back, and a
 * cancelled order crediting the wallet-funded share back.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";
import { requestCancellation, decideCancellation } from "./cancellation";
import { confirmOrder } from "./order-workflow";
import { getOrCreateWallet } from "./wallet";

const RUN = Date.now();

let sellerId: string;
let stateId: string;
let productId: string; // DEALER_ONLY, sellingPrice 1000, minOrderQty 1
let dealerUserId: string;
let dealerProfileId: string;
let adminUserId: string;

const cleanupUserIds: string[] = [];

async function addressPayload() {
  return {
    newAddress: {
      fullName: "Test Wallet Dealer",
      mobile: "+919999999997",
      altMobile: undefined,
      line1: "Wallet Road 1",
      cityTown: "Testville",
      district: "Test District",
      state: "Placeholder State",
      pincode: "411003",
      addressType: "SHOP" as const,
      isDefault: false,
    },
  };
}

async function setWalletBalance(userId: string, balance: number) {
  const wallet = await getOrCreateWallet(prisma, userId, "DEALER");
  await prisma.wallet.update({ where: { id: wallet.id }, data: { balance } });
  return wallet.id;
}

before(async () => {
  const state = await prisma.indianState.findFirstOrThrow({ where: { isActive: true } });
  stateId = state.id;
  const category = await prisma.category.findFirstOrThrow();

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-wallet-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE Seller",
      role: "SELLER",
      referralCode: `TESTWS${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test Wallet Shop ${RUN}`,
      slug: `test-wallet-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Wallet Product ${RUN}`,
      slug: `test-wallet-product-${RUN}`,
      sku: `TEST-WLT-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId: category.id,
      audience: "DEALER_ONLY",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      dealerVisible: true,
      customerVisible: false,
      primaryImageUrl: "/test.jpg",
      dealerAvailableStates: { connect: [{ id: stateId }] },
      dealerConfig: {
        create: { mrp: 1000, sellingPrice: 1000, minOrderQty: 1, currentStock: 1000, weight: 1000 },
      },
    },
  });
  productId = product.id;

  const dealerUser = await prisma.user.create({
    data: {
      phone: `+91903${RUN.toString().slice(-7)}`,
      firstName: "TEST FIXTURE Wallet Dealer",
      role: "DEALER",
      referralCode: `TESTWLD${RUN}`,
    },
  });
  dealerUserId = dealerUser.id;
  cleanupUserIds.push(dealerUser.id);
  const dealerProfile = await prisma.dealerProfile.create({
    data: { userId: dealerUser.id, status: "APPROVED", stateId },
  });
  dealerProfileId = dealerProfile.id;

  const adminUser = await prisma.user.create({
    data: {
      email: `test-wallet-admin-${RUN}@example.com`,
      firstName: "TEST FIXTURE Admin",
      role: "ADMIN",
      referralCode: `TESTWLA${RUN}`,
    },
  });
  adminUserId = adminUser.id;
  cleanupUserIds.push(adminUser.id);
});

after(async () => {
  await prisma.refundStatusHistory.deleteMany({
    where: { refundRequest: { sellerOrder: { sellerId } } },
  });
  await prisma.refundRequest.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.paymentAllocation.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.paymentStatusHistory.deleteMany({
    where: { payment: { checkoutGroup: { sellerOrders: { some: { sellerId } } } } },
  });
  await prisma.payment.deleteMany({
    where: { checkoutGroup: { sellerOrders: { some: { sellerId } } } },
  });
  await prisma.orderStatusHistory.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.orderCharge.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.orderItem.deleteMany({ where: { sellerOrder: { sellerId } } });
  const groups = await prisma.checkoutGroup.findMany({
    where: { sellerOrders: { some: { sellerId } } },
    select: { id: true },
  });
  await prisma.sellerOrder.deleteMany({ where: { sellerId } });
  await prisma.orderAddressSnapshot.deleteMany({
    where: { checkoutGroupId: { in: groups.map((g) => g.id) } },
  });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
  await prisma.cartItem.deleteMany({ where: { userId: dealerUserId } });
  await prisma.walletTransaction.deleteMany({ where: { wallet: { ownerId: dealerUserId } } });
  await prisma.wallet.deleteMany({ where: { ownerId: dealerUserId } });
  await prisma.dealerProfile.delete({ where: { id: dealerProfileId } }).catch(() => {});
  await prisma.productDealerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("dealer wallet balance is applied and deducted, remainder charged online", async () => {
  await setWalletBalance(dealerUserId, 400);
  await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    dealerUserId,
    { role: "DEALER", dealerState: { id: stateId, name: "Test State" } },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      walletAmountApplied: 400,
      // The remainder above the wallet-covered ₹400 is real money this
      // test isn't exercising — force the mock provider rather than a
      // live Razorpay call (see checkout.ts's applyInitialPayment: no
      // devSimulate means a real Razorpay Order gets created).
      devSimulatePaymentOutcome: "SUCCESS",
      idempotencyKey: `test-wallet-deduct-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const wallet = await prisma.wallet.findUnique({ where: { ownerId: dealerUserId } });
  assert.equal(Number(wallet!.balance), 0, "wallet balance should be fully spent");

  const payment = await prisma.payment.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  assert.equal(Number(payment!.walletAmountApplied), 400);
  assert.ok(
    Number(payment!.amountPaid) >= 400,
    "amountPaid should include the wallet-funded portion",
  );
});

test("a wallet request larger than the available balance is capped at the balance, not rejected", async () => {
  await setWalletBalance(dealerUserId, 150);
  await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    dealerUserId,
    { role: "DEALER", dealerState: { id: stateId, name: "Test State" } },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      walletAmountApplied: 999999,
      devSimulatePaymentOutcome: "SUCCESS",
      idempotencyKey: `test-wallet-insufficient-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const wallet = await prisma.wallet.findUnique({ where: { ownerId: dealerUserId } });
  assert.equal(Number(wallet!.balance), 0, "only the available balance is ever debited");

  const payment = await prisma.payment.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  assert.equal(
    Number(payment!.walletAmountApplied),
    150,
    "capped at the balance that actually existed",
  );
});

test("a failed remaining-charge attempt rolls the wallet debit back", async () => {
  await setWalletBalance(dealerUserId, 300);
  await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    dealerUserId,
    { role: "DEALER", dealerState: { id: stateId, name: "Test State" } },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      walletAmountApplied: 300,
      devSimulatePaymentOutcome: "FAILURE",
      idempotencyKey: `test-wallet-rollback-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const wallet = await prisma.wallet.findUnique({ where: { ownerId: dealerUserId } });
  assert.equal(
    Number(wallet!.balance),
    300,
    "wallet debit was reversed since the rest of the payment failed",
  );

  const payment = await prisma.payment.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  assert.equal(
    Number(payment!.walletAmountApplied),
    0,
    "nothing recorded as wallet-applied once rolled back",
  );
});

test("cancelling a wallet-funded order credits the applied amount back to the wallet", async () => {
  await setWalletBalance(dealerUserId, 500);
  await addToCart(
    dealerUserId,
    { role: "DEALER", dealerStateId: stateId },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    dealerUserId,
    { role: "DEALER", dealerState: { id: stateId, name: "Test State" } },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      walletAmountApplied: 500,
      devSimulatePaymentOutcome: "SUCCESS",
      idempotencyKey: `test-wallet-cancel-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const walletAfterCheckout = await prisma.wallet.findUnique({ where: { ownerId: dealerUserId } });
  assert.equal(Number(walletAfterCheckout!.balance), 0);

  const group = await prisma.checkoutGroup.findUnique({
    where: { id: result.checkoutGroupId },
    include: { sellerOrders: { include: { paymentAllocations: { include: { payment: true } } } } },
  });
  const order = group!.sellerOrders[0]!;
  // Order is placed as "Pending" — confirm it so the customer-initiated
  // cancellation flow (which starts from CONFIRMED) applies.
  assert.equal((await confirmOrder(adminUserId, order.id)).ok, true);
  // Real (non-wallet) money captured for this order — the product's own
  // ₹1000 price minus the ₹500 wallet-covered portion, plus whatever
  // delivery/logistics charge applies on top (computed here rather than
  // assumed, so this test doesn't silently drift from checkout's actual
  // charge math).
  const expectedNonWalletPaid = order.paymentAllocations.reduce(
    (sum, a) =>
      sum +
      Number(a.amount) * (Number(a.payment.amountPaid) / Number(a.payment.totalAmount || 1)) +
      Number(a.remainingCollectedAmount) -
      Number(a.walletAmountApplied),
    0,
  );
  assert.ok(expectedNonWalletPaid > 0, "fixture sanity check: some real money must have been captured");

  // A refund method is now required whenever real money was captured (see
  // cancellation.ts's requestCancellation).
  const noMethodResult = await requestCancellation(dealerUserId, "DEALER", {
    sellerOrderId: order.id,
    reason: "test cancellation without a method",
  });
  assert.equal(noMethodResult.ok, false, "refund method is required when real money was captured");

  const requestResult = await requestCancellation(dealerUserId, "DEALER", {
    sellerOrderId: order.id,
    reason: "test cancellation",
    refundMethod: "WALLET",
  });
  assert.equal(requestResult.ok, true);

  const decision = await decideCancellation(adminUserId, {
    sellerOrderId: order.id,
    approve: true,
    note: "test approve",
  });
  assert.equal(decision.ok, true);

  // The wallet-funded ₹500 (checked below, unchanged from before) and the
  // remaining real-money portion are two SEPARATE refund paths — this
  // confirms the new one: an order-level (orderItemId null) RefundRequest
  // for the real-money portion, created straight at APPROVED (no separate
  // review step — the admin's cancellation approval above IS the
  // approval), ready for completeRefund.
  const cancellationRefund = await prisma.refundRequest.findFirst({
    where: { sellerOrderId: order.id, orderItemId: null },
  });
  assert.ok(cancellationRefund, "a whole-order refund request was created for the real-money portion");
  assert.equal(cancellationRefund!.status, "APPROVED");
  assert.equal(cancellationRefund!.refundMethod, "WALLET");
  assert.equal(Number(cancellationRefund!.amount), expectedNonWalletPaid);

  const walletAfterCancel = await prisma.wallet.findUnique({ where: { ownerId: dealerUserId } });
  assert.equal(
    Number(walletAfterCancel!.balance),
    500,
    "wallet-funded amount is credited back on cancellation",
  );

  const allocation = await prisma.paymentAllocation.findFirst({
    where: { sellerOrderId: order.id },
  });
  assert.equal(allocation!.walletRefunded, true);
});
