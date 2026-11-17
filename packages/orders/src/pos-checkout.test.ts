/**
 * Integration tests against the real dev Postgres (same convention as
 * customer-checkout.test.ts) for the POS-only discount pricing
 * calculator: discount applied BEFORE tax (tax computed on the
 * discounted subtotal, not the gross one — the actual bug being fixed
 * here, see checkout-draft.ts's isPosCustomerOrder branch), rates read
 * live from the admin-configurable PosPricingConfig singleton (not
 * hardcoded), and scoped strictly to a CUSTOMER order placed via POS —
 * a DEALER order placed via POS, and any non-POS customer order, must
 * keep using the existing hardcoded promo table unaffected. The
 * ONLINE_PARTIAL amount collected now is always operator-entered (per
 * order, in POS) against the discounted total — never a fixed
 * percentage — and the COD amount actually sent to RapidShyp after
 * payment-proof approval is verified to be exactly what's left.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { addToCart } from "./cart";
import { checkout } from "./checkout";

const RUN = Date.now();

let sellerId: string;
let categoryId: string;
let productId: string;
let staffUserId: string;
const cleanupUserIds: string[] = [];
let existingPosPricingConfig: Awaited<ReturnType<typeof prisma.posPricingConfig.findUnique>> = null;

async function makeCustomer(suffix: string) {
  const user = await prisma.user.create({
    data: {
      phone: `+91902${RUN.toString().slice(-6)}${suffix}`,
      firstName: "TEST FIXTURE POS Customer",
      role: "CUSTOMER",
      referralCode: `TESTFPC${RUN}${suffix}`,
    },
  });
  cleanupUserIds.push(user.id);
  return user.id;
}

async function addressPayload() {
  return {
    newAddress: {
      fullName: "Test POS Customer",
      mobile: "+919999999998",
      altMobile: undefined,
      line1: "Farm Road 2",
      cityTown: "Testville",
      district: "Test District",
      state: "Maharashtra",
      pincode: "411001",
      addressType: "HOME" as const,
      isDefault: false,
    },
  };
}

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;

  const sellerUser = await prisma.user.create({
    data: {
      email: `test-pos-checkout-seller-${RUN}@example.com`,
      firstName: "TEST FIXTURE POS Seller",
      role: "SELLER",
      referralCode: `TESTFPS${RUN}`,
    },
  });
  cleanupUserIds.push(sellerUser.id);
  const sellerProfile = await prisma.sellerProfile.create({
    data: {
      userId: sellerUser.id,
      shopName: `Test POS Checkout Shop ${RUN}`,
      slug: `test-pos-checkout-shop-${RUN}`,
      status: "APPROVED",
    },
  });
  sellerId = sellerProfile.id;

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test POS Checkout Product ${RUN}`,
      slug: `test-pos-checkout-product-${RUN}`,
      sku: `TEST-FPP-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: true,
      primaryImageUrl: "/test.jpg",
      // Nonzero tax on purpose — this is what distinguishes "discount
      // before tax" from "discount after tax" in the assertions below;
      // customer-checkout.test.ts's fixture product has 0% tax, which
      // can't tell the two orderings apart.
      taxPercent: 10,
      customerConfig: {
        // EXCLUDE_WITH_PRICE pinned explicitly — this test is about
        // discount-vs-tax ORDERING, not the separate tax-inclusive-price
        // feature, so it keeps testing tax-added-on-top regardless of
        // whichever mode is the schema's current default.
        create: {
          mrp: 1000,
          sellingPrice: 1000,
          minOrderQty: 1,
          currentStock: 1000,
          weight: 500,
          taxCalcMode: "EXCLUDE_WITH_PRICE",
        },
      },
      dealerConfig: {
        create: {
          mrp: 1000,
          sellingPrice: 900,
          minOrderQty: 1,
          currentStock: 1000,
          weight: 500,
          taxCalcMode: "EXCLUDE_WITH_PRICE",
        },
      },
    },
  });
  productId = product.id;

  const staffUser = await prisma.user.create({
    data: {
      email: `test-pos-checkout-staff-${RUN}@example.com`,
      firstName: "TEST FIXTURE POS Staff",
      role: "ADMIN",
      referralCode: `TESTFPSTAFF${RUN}`,
    },
  });
  cleanupUserIds.push(staffUser.id);
  staffUserId = staffUser.id;

  existingPosPricingConfig = await prisma.posPricingConfig.findUnique({
    where: { id: "singleton" },
  });
  // Distinct from the spec's own defaults (0/5/2) so a passing assertion
  // actually proves this reads the config table live, not a hardcoded
  // fallback that happens to match.
  await prisma.posPricingConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      codDiscountPercent: 0,
      fullPrepaidDiscountPercent: 10,
      partialPrepaidDiscountPercent: 4,
    },
    update: {
      codDiscountPercent: 0,
      fullPrepaidDiscountPercent: 10,
      partialPrepaidDiscountPercent: 4,
    },
  });
});

after(async () => {
  if (existingPosPricingConfig) {
    await prisma.posPricingConfig.update({
      where: { id: "singleton" },
      data: {
        codDiscountPercent: existingPosPricingConfig.codDiscountPercent,
        fullPrepaidDiscountPercent: existingPosPricingConfig.fullPrepaidDiscountPercent,
        partialPrepaidDiscountPercent: existingPosPricingConfig.partialPrepaidDiscountPercent,
      },
    });
  } else {
    await prisma.posPricingConfig.delete({ where: { id: "singleton" } }).catch(() => {});
  }

  await prisma.posPaymentProofSubmission.deleteMany({
    where: { checkoutGroup: { sellerOrders: { some: { sellerId } } } },
  });
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
  await prisma.cartItem.deleteMany({ where: { productId } });
  await prisma.productCustomerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.productDealerConfig.delete({ where: { productId } }).catch(() => {});
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  await prisma.sellerProfile.delete({ where: { id: sellerId } }).catch(() => {});
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

test("POS + CUSTOMER + full prepaid: discount applied BEFORE tax (tax on the discounted price, not the gross one)", async () => {
  const customerUserId = await makeCustomer("A");
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    customerUserId,
    {
      role: "CUSTOMER",
      dealerState: null,
      placedBy: { id: staffUserId, name: "Test Staff" },
      requiresManualPaymentApproval: true,
    },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      idempotencyKey: `test-pos-full-prepaid-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const order = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { charge: true },
  });
  // basePrice 1000, 10% config discount -> discountAmount 100, discountedPrice 900,
  // 10% product tax on the DISCOUNTED price -> tax 90, totalOrderValue 990.
  // The pre-fix formula (tax on the gross 1000, discount only netted off
  // the total afterward) would have produced customerPayableTotal 1000
  // (1000 subtotal + 100 gross tax - 100 discount) instead — this
  // assertion is exactly what distinguishes the two.
  assert.equal(Number(order!.charge!.promotionalDiscountPercent), 10);
  assert.equal(Number(order!.charge!.promotionalDiscountAmount), 100);
  assert.equal(Number(order!.subtotal), 1000); // seller's own settlement basis stays gross
  assert.equal(Number(order!.taxAmount), 100); // ditto — gross tax, unaffected
  assert.equal(Number(order!.charge!.customerPayableTotal), 990);
});

test("POS + CUSTOMER + partial prepaid: the operator-entered amount is collected now against the DISCOUNTED total, the rest is COD", async () => {
  const customerUserId = await makeCustomer("B");
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    customerUserId,
    {
      role: "CUSTOMER",
      dealerState: null,
      placedBy: { id: staffUserId, name: "Test Staff" },
      requiresManualPaymentApproval: true,
      // Operator (admin/employee) enters this in POS — must be validated
      // and charged against the DISCOUNTED total (customerPayableTotal),
      // never the gross one.
      posAdvanceAmount: 400,
    },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_PARTIAL",
      idempotencyKey: `test-pos-partial-prepaid-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const order = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { charge: true },
  });
  // 4% config discount -> discountAmount 40, discountedPrice 960, 10% tax
  // on 960 -> 96, totalOrderValue 1056.
  assert.equal(Number(order!.charge!.promotionalDiscountPercent), 4);
  assert.equal(Number(order!.charge!.customerPayableTotal), 1056);

  const payment = await prisma.payment.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  // Exactly what the operator typed, not a config-derived percentage.
  assert.equal(Number(payment!.totalAmount), 400);

  // Simulate the admin approving the payment-proof screenshot — this is
  // what actually marks the entered amount as collected.
  const { decidePosPaymentProof } = await import("./pos-payment-proof");
  const submission = await prisma.posPaymentProofSubmission.create({
    data: {
      checkoutGroupId: result.checkoutGroupId,
      uploadedById: staffUserId,
      amount: 400,
      screenshotStorageKey: "test/test-proof.jpg",
      screenshotMimeType: "image/jpeg",
      screenshotSizeBytes: 1024,
      status: "PENDING",
    },
  });
  const decision = await decidePosPaymentProof(
    submission.id,
    { action: "APPROVE" },
    { id: staffUserId, role: "ADMIN" },
  );
  assert.equal(decision.ok, true);

  // rapidshyp-shipping.ts's amountAlreadyPaid formula reads exactly this:
  // allocation.amount * (payment.amountPaid / payment.totalAmount) +
  // remainingCollectedAmount. Once approved, amountPaid === totalAmount
  // (400), so the COD amount RapidShyp is told to collect is 1056 - 400 =
  // 656 — "what's left" after the operator-entered prepaid amount.
  const allocation = await prisma.paymentAllocation.findFirst({
    where: { sellerOrderId: order!.id },
    include: { payment: true },
  });
  const amountAlreadyPaid =
    Number(allocation!.amount) *
      (Number(allocation!.payment.amountPaid) / Number(allocation!.payment.totalAmount)) +
    Number(allocation!.remainingCollectedAmount);
  assert.equal(amountAlreadyPaid, 400);
  assert.equal(Number(order!.charge!.customerPayableTotal) - amountAlreadyPaid, 656);

  await prisma.posPaymentProofSubmission.delete({ where: { id: submission.id } });
});

test("POS + CUSTOMER + tax-inclusive product: the discount % comes off the TAXABLE value, not the tax-inclusive sticker price", async () => {
  // A product whose selling price ALREADY has GST baked in
  // (taxCalcMode INCLUDE_WITH_PRICE) — ₹595 at 5% tax, i.e. ₹566.67
  // taxable + ₹28.33 tax. The POS prepaid discount must be a percentage
  // of the ₹566.67 taxable value, never of the ₹595 sticker price.
  const inclProduct = await prisma.product.create({
    data: {
      sellerId,
      name: `Test POS Tax-Inclusive Product ${RUN}`,
      slug: `test-pos-tax-inclusive-product-${RUN}`,
      sku: `TEST-FPP-INCL-${RUN}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: true,
      primaryImageUrl: "/test.jpg",
      taxPercent: 5,
      customerConfig: {
        create: {
          mrp: 595,
          sellingPrice: 595,
          minOrderQty: 1,
          currentStock: 1000,
          weight: 500,
          taxCalcMode: "INCLUDE_WITH_PRICE",
        },
      },
    },
  });

  const customerUserId = await makeCustomer("INCL");
  await addToCart(
    customerUserId,
    { role: "CUSTOMER", dealerStateId: null },
    { productId: inclProduct.id, quantity: 1 },
  );

  const result = await checkout(
    customerUserId,
    {
      role: "CUSTOMER",
      dealerState: null,
      placedBy: { id: staffUserId, name: "Test Staff" },
      requiresManualPaymentApproval: true,
    },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      idempotencyKey: `test-pos-tax-incl-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const order = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { charge: true },
  });
  // ₹595 incl. 5% tax -> taxable ₹566.67. 10% full-prepaid config discount
  // is 10% of ₹566.67 = ₹56.67 (NOT 10% of ₹595 = ₹59.50, which is what
  // the pre-fix formula produced). Discounted taxable ₹510.00, 5% tax on
  // that = ₹25.50, so the customer pays ₹535.50.
  assert.equal(Number(order!.charge!.promotionalDiscountPercent), 10);
  assert.equal(Number(order!.charge!.promotionalDiscountAmount), 56.67);
  assert.equal(Number(order!.subtotal), 566.67); // seller's gross settlement basis — taxable, unchanged
  assert.equal(Number(order!.taxAmount), 28.33); // ditto — gross tax on the full ₹595
  assert.equal(Number(order!.charge!.customerPayableTotal), 535.5);

  // Cleanup — this test owns an extra product the shared after() doesn't know about.
  await prisma.paymentAllocation.deleteMany({ where: { sellerOrderId: order!.id } });
  await prisma.paymentStatusHistory.deleteMany({
    where: { payment: { checkoutGroupId: result.checkoutGroupId } },
  });
  await prisma.payment.deleteMany({ where: { checkoutGroupId: result.checkoutGroupId } });
  await prisma.orderStatusHistory.deleteMany({ where: { sellerOrderId: order!.id } });
  await prisma.orderCharge.deleteMany({ where: { sellerOrderId: order!.id } });
  await prisma.orderItem.deleteMany({ where: { sellerOrderId: order!.id } });
  await prisma.sellerOrder.delete({ where: { id: order!.id } });
  await prisma.orderAddressSnapshot.deleteMany({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  await prisma.checkoutGroup.delete({ where: { id: result.checkoutGroupId } });
  await prisma.cartItem.deleteMany({ where: { productId: inclProduct.id } });
  await prisma.productCustomerConfig.delete({ where: { productId: inclProduct.id } });
  await prisma.product.delete({ where: { id: inclProduct.id } });
});

test("POS + DEALER order keeps today's exact behavior — the configured POS rates never apply", async () => {
  const dealerUser = await prisma.user.create({
    data: {
      phone: `+91903${RUN.toString().slice(-6)}`,
      firstName: "TEST FIXTURE POS Dealer",
      role: "DEALER",
      referralCode: `TESTFPD${RUN}`,
    },
  });
  cleanupUserIds.push(dealerUser.id);
  const state = await prisma.indianState.findFirstOrThrow();
  const dealerProfile = await prisma.dealerProfile.create({
    data: {
      userId: dealerUser.id,
      storeName: `Test POS Dealer Store ${RUN}`,
      status: "APPROVED",
      stateId: state.id,
    },
  });

  await addToCart(
    dealerUser.id,
    { role: "DEALER", dealerStateId: dealerProfile.stateId },
    { productId, quantity: 1 },
  );

  const result = await checkout(
    dealerUser.id,
    {
      role: "DEALER",
      dealerState: { id: dealerProfile.stateId!, name: state.name },
      placedBy: { id: staffUserId, name: "Test Staff" },
      requiresManualPaymentApproval: true,
    },
    {
      ...(await addressPayload()),
      deliveryMethod: "KISAN4U_COURIER",
      paymentMethod: "ONLINE_FULL",
      idempotencyKey: `test-pos-dealer-${RUN}`,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const order = await prisma.sellerOrder.findFirst({
    where: { checkoutGroupId: result.checkoutGroupId },
    include: { charge: true },
  });
  // The hardcoded promo table gives DEALER 0% regardless of payment
  // method — the 10% POS config configured in `before` above must never
  // apply here.
  assert.equal(Number(order!.charge!.promotionalDiscountPercent), 0);
  assert.equal(Number(order!.charge!.promotionalDiscountAmount), 0);

  await prisma.paymentAllocation.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.paymentStatusHistory.deleteMany({
    where: { payment: { checkoutGroupId: result.checkoutGroupId } },
  });
  await prisma.payment.deleteMany({ where: { checkoutGroupId: result.checkoutGroupId } });
  await prisma.orderStatusHistory.deleteMany({ where: { sellerOrder: { sellerId } } });
  await prisma.orderCharge.deleteMany({ where: { sellerOrderId: order!.id } });
  await prisma.orderItem.deleteMany({ where: { sellerOrderId: order!.id } });
  await prisma.sellerOrder.delete({ where: { id: order!.id } });
  await prisma.orderAddressSnapshot.deleteMany({
    where: { checkoutGroupId: result.checkoutGroupId },
  });
  await prisma.checkoutGroup.delete({ where: { id: result.checkoutGroupId } });
  await prisma.dealerProfile.delete({ where: { id: dealerProfile.id } });
});
