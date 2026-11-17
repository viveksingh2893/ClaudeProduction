/**
 * Integration tests against the real dev Postgres — same convention as
 * settlement.test.ts: throwaway fixtures keyed by a unique RUN timestamp,
 * cleaned up in `after`. Deliberately never uses the literal seller names
 * "Katra"/"Royal Traders" — every test passes an explicit SellerScope
 * built from its own scratch seller(s), so these tests can never touch
 * real production data, and a small dedicated block at the bottom tests
 * resolveSellerByExactName's own exact-match/ambiguity behavior in
 * isolation using its own scratch sellers.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import {
  planBulkPriceUpdate,
  applyBulkPriceUpdate,
  computePriceIncrease,
  resolveSellerByExactName,
  isBulkPriceUpdateAlreadyApplied,
  type SellerScope,
} from "./bulk-price-update";

const RUN = Date.now();
// Every test that touches the idempotency marker gets its OWN unique
// marker via testMarker() below — never the real BULK_PRICE_UPDATE_MARKER
// (fixed entityId, meant to guard the real Katra/Royal migration forever:
// writing or cleaning that up from a test run risks either leaving a
// stray row that wrongly blocks the real migration later, or clearing a
// genuine completed run's guard), and never one SHARED marker reused
// across multiple tests in this file (the first test to successfully
// apply would make every later test in the same run see
// alreadyApplied:true too — the exact same collision, just scoped to one
// file run instead of forever).
let markerSuffix = 0;
function testMarker() {
  markerSuffix++;
  return {
    action: "BULK_PRICE_INCREASE_APPLIED",
    entityType: "BulkPriceUpdate",
    entityId: `test-bulk-price-update-${RUN}-${markerSuffix}`,
  };
}
let categoryId: string;
const cleanupSellerIds: string[] = [];
const cleanupUserIds: string[] = [];
const cleanupProductIds: string[] = [];

before(async () => {
  const category = await prisma.category.findFirstOrThrow();
  categoryId = category.id;
});

after(async () => {
  await prisma.auditLog.deleteMany({
    where: { entityType: "BulkPriceUpdate", entityId: { startsWith: `test-bulk-price-update-${RUN}-` } },
  });
  // Defensive — the historical-order test cleans up its own SellerOrder/
  // OrderItem/CheckoutGroup rows inline, but if that test fails before
  // reaching its own cleanup lines, those rows would otherwise block the
  // sellerProfile deleteMany below with a foreign-key violation and leave
  // every subsequent test's fixtures uncleaned too.
  await prisma.orderItem.deleteMany({ where: { sellerOrder: { sellerId: { in: cleanupSellerIds } } } });
  await prisma.sellerOrder.deleteMany({ where: { sellerId: { in: cleanupSellerIds } } });
  await prisma.checkoutGroup.deleteMany({ where: { groupNumber: { startsWith: `TEST-BP-HIST-${RUN}` } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: cleanupProductIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: cleanupProductIds } } });
  await prisma.productDealerConfig.deleteMany({ where: { productId: { in: cleanupProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: cleanupProductIds } } });
  await prisma.sellerProfile.deleteMany({ where: { id: { in: cleanupSellerIds } } });
  for (const id of cleanupUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

let sellerSuffix = 0;
async function makeSeller(label: string): Promise<SellerScope> {
  sellerSuffix++;
  const shopName = `Test Bulk Price ${label} ${RUN}-${sellerSuffix}`;
  const user = await prisma.user.create({
    data: {
      email: `test-bulk-price-${label.toLowerCase()}-${RUN}-${sellerSuffix}@example.com`,
      firstName: `TEST FIXTURE Bulk Price ${label}`,
      role: "SELLER",
      referralCode: `TESTBP${label.toUpperCase()}${RUN}${sellerSuffix}`,
    },
  });
  cleanupUserIds.push(user.id);
  const seller = await prisma.sellerProfile.create({
    data: {
      userId: user.id,
      shopName,
      slug: `test-bulk-price-${label.toLowerCase()}-${RUN}-${sellerSuffix}`,
      status: "APPROVED",
    },
  });
  cleanupSellerIds.push(seller.id);
  return { sellerId: seller.id, label: shopName };
}

let productSuffix = 0;
type NoVariantOpts = {
  audience?: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER";
  taxPercent?: number;
  customerPrice?: { sellingPrice: number; mrp: number } | null;
  dealerPrice?: { sellingPrice: number; mrp: number } | null;
};

/** A no-variant product — customerConfig/dealerConfig carry the real, only price. */
async function makeNoVariantProduct(sellerId: string, opts: NoVariantOpts = {}): Promise<string> {
  productSuffix++;
  const audience = opts.audience ?? "BOTH_CUSTOMER_AND_DEALER";
  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Bulk Price No-Variant Product ${RUN}-${productSuffix}`,
      slug: `test-bulk-price-novariant-${RUN}-${productSuffix}`,
      sku: `TEST-BP-NV-${RUN}-${productSuffix}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId,
      audience,
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: true,
      primaryImageUrl: "/test.jpg",
      // Decimal columns can't truly be NULL here — the "missing tax" test
      // simulates an invalid rate with a negative value instead of a real
      // absence (see that test's own comment).
      taxPercent: opts.taxPercent === undefined ? 18 : opts.taxPercent,
      // Only ever created when the caller EXPLICITLY passes a price object
      // — never a silent default. Passing neither `customerPrice` nor
      // `dealerPrice` produces a product with no config on that side at
      // all, exactly like a real CUSTOMER_ONLY/DEALER_ONLY product; the
      // explicit `null` form is equivalent (kept only for a test's own
      // readability when contrasting "customer: yes, dealer: explicitly
      // no" in the same call).
      customerConfig:
        opts.customerPrice != null
          ? {
              create: {
                mrp: opts.customerPrice.mrp,
                sellingPrice: opts.customerPrice.sellingPrice,
                minOrderQty: 1,
                currentStock: 100,
                weight: 500,
              },
            }
          : undefined,
      dealerConfig:
        opts.dealerPrice != null
          ? {
              create: {
                mrp: opts.dealerPrice.mrp,
                sellingPrice: opts.dealerPrice.sellingPrice,
                minOrderQty: 1,
                currentStock: 100,
                weight: 500,
              },
            }
          : undefined,
    },
  });
  cleanupProductIds.push(product.id);
  return product.id;
}

type VariantOpts = {
  taxPercent?: number;
  /** Base "Display on product card" config — omit for the usual placeholder (mrp=0, out of scope). */
  customerCardPrice?: { sellingPrice: number; mrp: number };
  dealerCardPrice?: { sellingPrice: number; mrp: number };
  customerVariants?: { sellingPrice: number; mrp: number; isActive?: boolean }[];
  dealerVariants?: { sellingPrice: number; mrp: number; isActive?: boolean }[];
};

/** A variant product — customerConfig/dealerConfig are the placeholder card-price rows (mrp=0 unless customerCardPrice/dealerCardPrice given), real prices live on each ProductVariant. */
async function makeVariantProduct(sellerId: string, opts: VariantOpts = {}): Promise<string> {
  productSuffix++;
  const hasCustomer = (opts.customerVariants?.length ?? 0) > 0 || opts.customerCardPrice;
  const hasDealer = (opts.dealerVariants?.length ?? 0) > 0 || opts.dealerCardPrice;
  const audience =
    hasCustomer && hasDealer ? "BOTH_CUSTOMER_AND_DEALER" : hasDealer ? "DEALER_ONLY" : "CUSTOMER_ONLY";

  const product = await prisma.product.create({
    data: {
      sellerId,
      name: `Test Bulk Price Variant Product ${RUN}-${productSuffix}`,
      slug: `test-bulk-price-variant-${RUN}-${productSuffix}`,
      sku: `TEST-BP-V-${RUN}-${productSuffix}`,
      hsnCode: "1234",
      shortDescription: "test",
      description: "test",
      categoryId,
      audience,
      baseUnit: "KG",
      packageSize: "1 kg",
      lifecycleStatus: "APPROVED",
      customerVisible: true,
      dealerVisible: true,
      primaryImageUrl: "/test.jpg",
      taxPercent: opts.taxPercent ?? 18,
      customerConfig: hasCustomer
        ? {
            create: {
              mrp: opts.customerCardPrice?.mrp ?? 0,
              sellingPrice: opts.customerCardPrice?.sellingPrice ?? 0,
              minOrderQty: 1,
              currentStock: 0,
              weight: 500,
            },
          }
        : undefined,
      dealerConfig: hasDealer
        ? {
            create: {
              mrp: opts.dealerCardPrice?.mrp ?? 0,
              sellingPrice: opts.dealerCardPrice?.sellingPrice ?? 0,
              minOrderQty: 1,
              currentStock: 0,
              weight: 500,
            },
          }
        : undefined,
    },
  });
  cleanupProductIds.push(product.id);

  let combo = 0;
  for (const v of opts.customerVariants ?? []) {
    combo++;
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        audience: "CUSTOMER",
        combinationKey: `test-bp-combo-${RUN}-${productSuffix}-c${combo}`,
        sku: `TEST-BP-V-${RUN}-${productSuffix}-CUS-${combo}`,
        mrp: v.mrp,
        sellingPrice: v.sellingPrice,
        minOrderQty: 1,
        stockQty: 100,
        weight: 500,
        isActive: v.isActive ?? true,
      },
    });
  }
  for (const v of opts.dealerVariants ?? []) {
    combo++;
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        audience: "DEALER",
        combinationKey: `test-bp-combo-${RUN}-${productSuffix}-d${combo}`,
        sku: `TEST-BP-V-${RUN}-${productSuffix}-DEA-${combo}`,
        mrp: v.mrp,
        sellingPrice: v.sellingPrice,
        minOrderQty: 1,
        stockQty: 100,
        weight: 500,
        isActive: v.isActive ?? true,
      },
    });
  }
  return product.id;
}

// ---------------------------------------------------------------------------
// 1-2. Exact worked examples from the spec.
// ---------------------------------------------------------------------------

test("₹100 customer price, 18% tax -> ₹102.00 exactly (spec example 1)", () => {
  const calc = computePriceIncrease(100, 18, "INCLUDE_WITH_PRICE", 2);
  assert.equal(calc.newSellingPrice, 102);
});

test("₹1,000 dealer price, 18% tax -> ₹1,030.00 exactly, not ₹1,029.9984 (spec example 2)", () => {
  const calc = computePriceIncrease(1000, 18, "INCLUDE_WITH_PRICE", 3);
  assert.equal(calc.newSellingPrice, 1030);
});

// ---------------------------------------------------------------------------
// 3-4. Other tax rates, including zero.
// ---------------------------------------------------------------------------

test("tax rate other than 18% (5%) computes correctly", () => {
  const calc = computePriceIncrease(595, 5, "INCLUDE_WITH_PRICE", 2);
  // taxable = 595/1.05 = 566.666...67; new taxable = *1.02 = 578.0000...02;
  // new price = *1.05 = 606.90000...02 -> rounds to 606.90
  assert.equal(calc.newSellingPrice, 606.9);
});

test("zero-percent tax: taxable value equals the price, increase applies directly", () => {
  const calc = computePriceIncrease(3999, 0, "INCLUDE_WITH_PRICE", 2);
  assert.equal(calc.oldTaxableValue, 3999);
  assert.equal(calc.newSellingPrice, 4078.98); // 3999 * 1.02
});

// ---------------------------------------------------------------------------
// 5-8. Product shapes: with/without variants, both/customer-only/dealer-only.
// ---------------------------------------------------------------------------

test("product WITH variants: every customer and dealer variant is updated, base placeholder config (mrp=0) is skipped", async () => {
  const seller = await makeSeller("Variants");
  await makeVariantProduct(seller.sellerId, {
    taxPercent: 18,
    customerVariants: [{ sellingPrice: 100, mrp: 150 }],
    dealerVariants: [{ sellingPrice: 1000, mrp: 1200 }],
  });

  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.productsExamined, 1);
  assert.equal(plan.productsAffected, 1);
  assert.equal(plan.variantsExamined, 2);
  assert.equal(plan.variantsAffected, 2);
  assert.equal(plan.customerPricesPlanned, 1);
  assert.equal(plan.dealerPricesPlanned, 1);

  const customerVariantUpdate = plan.updates.find((u) => u.audience === "CUSTOMER" && u.kind === "VARIANT");
  const dealerVariantUpdate = plan.updates.find((u) => u.audience === "DEALER" && u.kind === "VARIANT");
  assert.equal(customerVariantUpdate?.newSellingPrice, 102);
  assert.equal(dealerVariantUpdate?.newSellingPrice, 1030);

  // The placeholder base configs (mrp=0) must be skipped, never updated.
  const baseConfigUpdates = plan.updates.filter((u) => u.kind === "VARIANT_BASE_CONFIG");
  assert.equal(baseConfigUpdates.length, 0);
  assert.equal(plan.skipped.length, 2); // customerConfig + dealerConfig placeholders
});

test("variant product WITH a real 'Display on product card' base price: base config AND every variant are both updated independently", async () => {
  const seller = await makeSeller("CardPrice");
  await makeVariantProduct(seller.sellerId, {
    taxPercent: 18,
    customerCardPrice: { sellingPrice: 200, mrp: 250 },
    customerVariants: [{ sellingPrice: 100, mrp: 150 }],
  });

  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.variantsAffected, 1);
  const baseConfigUpdate = plan.updates.find((u) => u.kind === "VARIANT_BASE_CONFIG");
  const variantUpdate = plan.updates.find((u) => u.kind === "VARIANT");
  assert.ok(baseConfigUpdate, "base card price must be updated, not skipped");
  assert.equal(baseConfigUpdate!.newSellingPrice, 204); // 200 * 1.02 (18% cancels exactly)
  assert.equal(variantUpdate!.newSellingPrice, 102);
  // Two genuinely separate prices, not the same logical price updated twice.
  assert.notEqual(baseConfigUpdate!.productId + "|" + baseConfigUpdate!.variantId, variantUpdate!.productId + "|" + variantUpdate!.variantId);
});

test("product WITHOUT variants: the config row itself is the authoritative price and is updated directly", async () => {
  const seller = await makeSeller("NoVariant");
  await makeNoVariantProduct(seller.sellerId, {
    audience: "BOTH_CUSTOMER_AND_DEALER",
    taxPercent: 18,
    customerPrice: { sellingPrice: 100, mrp: 150 },
    dealerPrice: { sellingPrice: 1000, mrp: 1200 },
  });

  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.productsAffected, 1);
  assert.equal(plan.variantsExamined, 0);
  assert.equal(plan.variantsAffected, 0);
  const customerUpdate = plan.updates.find((u) => u.audience === "CUSTOMER");
  const dealerUpdate = plan.updates.find((u) => u.audience === "DEALER");
  assert.equal(customerUpdate?.kind, "NO_VARIANT_CONFIG");
  assert.equal(customerUpdate?.newSellingPrice, 102);
  assert.equal(dealerUpdate?.newSellingPrice, 1030);
});

test("product available to BOTH customer and dealer: both sides update independently at their own percentage", async () => {
  const seller = await makeSeller("Both");
  await makeNoVariantProduct(seller.sellerId, {
    audience: "BOTH_CUSTOMER_AND_DEALER",
    taxPercent: 12,
    customerPrice: { sellingPrice: 100, mrp: 200 },
    dealerPrice: { sellingPrice: 500, mrp: 900 },
  });
  const plan = await planBulkPriceUpdate([seller], testMarker());
  const customerUpdate = plan.updates.find((u) => u.audience === "CUSTOMER")!;
  const dealerUpdate = plan.updates.find((u) => u.audience === "DEALER")!;
  assert.equal(customerUpdate.increasePercent, 2);
  assert.equal(dealerUpdate.increasePercent, 3);
  assert.equal(customerUpdate.newSellingPrice, 102); // 100 * 1.02
  assert.equal(dealerUpdate.newSellingPrice, 515); // 500 * 1.03
});

test("customer-only and dealer-only products: only the applicable side is ever touched", async () => {
  const seller = await makeSeller("Single");
  await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 18,
    customerPrice: { sellingPrice: 100, mrp: 200 },
    dealerPrice: null,
  });
  await makeNoVariantProduct(seller.sellerId, {
    audience: "DEALER_ONLY",
    taxPercent: 18,
    customerPrice: null,
    dealerPrice: { sellingPrice: 1000, mrp: 1500 },
  });

  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.customerPricesPlanned, 1);
  assert.equal(plan.dealerPricesPlanned, 1);
  assert.equal(plan.updates.length, 2);
});

// ---------------------------------------------------------------------------
// 9. Scope isolation — a product belonging to neither seller is untouched.
// ---------------------------------------------------------------------------

test("a product belonging to a DIFFERENT seller is never examined or affected", async () => {
  const targetSeller = await makeSeller("InScope");
  const otherSeller = await makeSeller("OutOfScope");
  await makeNoVariantProduct(targetSeller.sellerId, { customerPrice: { sellingPrice: 100, mrp: 200 } });
  const untouchedProductId = await makeNoVariantProduct(otherSeller.sellerId, {
    customerPrice: { sellingPrice: 100, mrp: 200 },
  });

  const plan = await planBulkPriceUpdate([targetSeller], testMarker()); // otherSeller NOT in scope
  assert.equal(plan.productsExamined, 1);
  assert.ok(!plan.updates.some((u) => u.productId === untouchedProductId));

  const before = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId: untouchedProductId } });
  assert.equal(Number(before.sellingPrice), 100);
});

// ---------------------------------------------------------------------------
// 10-11. Invalid / missing data.
// ---------------------------------------------------------------------------

test("missing/invalid tax percentage: record is rejected, not guessed, and reported", async () => {
  const seller = await makeSeller("BadTax");
  // A negative tax percent stands in for "invalid" here — Product.taxPercent
  // is a NOT NULL Decimal column (no real NULL is representable), so the
  // validation this test proves is the "reject anything that isn't a
  // valid non-negative rate" branch, not literal absence.
  await makeNoVariantProduct(seller.sellerId, {
    taxPercent: -5,
    customerPrice: { sellingPrice: 100, mrp: 200 },
  });

  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.rejected.length, 1);
  assert.match(plan.rejected[0]!.reason, /taxPercent/);
});

test("missing price: a product with neither customer nor dealer config produces zero updates, not an error", async () => {
  const seller = await makeSeller("NoPrice");
  await makeNoVariantProduct(seller.sellerId, {
    audience: "BOTH_CUSTOMER_AND_DEALER",
    customerPrice: null,
    dealerPrice: null,
  });
  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.rejected.length, 0); // config simply doesn't exist — not an invalid-data rejection
});

test("zero sellingPrice: the record is SKIPPED (nothing to increase), not updated to 0 and not rejected", async () => {
  const marker = testMarker();
  const seller = await makeSeller("ZeroPrice");
  // A no-variant config priced at 0, plus a real variant on another product —
  // the zero-price row must be skipped, the real one must still come through.
  const zeroPriceId = await makeNoVariantProduct(seller.sellerId, {
    audience: "DEALER_ONLY",
    taxPercent: 5,
    customerPrice: null,
    dealerPrice: { sellingPrice: 0, mrp: 0 },
  });
  const realId = await makeVariantProduct(seller.sellerId, {
    taxPercent: 5,
    dealerVariants: [
      { sellingPrice: 300, mrp: 500 },
      { sellingPrice: 0, mrp: 0 }, // a zero-price variant on an otherwise-real product
    ],
  });

  const plan = await planBulkPriceUpdate([seller], marker);
  // Neither zero-price row is an update or a rejection.
  assert.ok(!plan.updates.some((u) => u.productId === zeroPriceId));
  assert.ok(!plan.rejected.some((r) => r.productId === zeroPriceId));
  assert.ok(plan.skipped.some((s) => s.productId === zeroPriceId && /sellingPrice is 0/.test(s.reason)));
  // The real variant on `realId` still planned; its zero-price sibling skipped.
  const realUpdates = plan.updates.filter((u) => u.productId === realId);
  assert.equal(realUpdates.length, 1);
  assert.equal(realUpdates[0]!.oldSellingPrice, 300);
  assert.equal(plan.skipped.filter((s) => s.productId === realId && /sellingPrice is 0/.test(s.reason)).length, 1);

  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", marker);
  assert.equal(result.ok, true);

  const zeroAfter = await prisma.productDealerConfig.findUniqueOrThrow({ where: { productId: zeroPriceId } });
  assert.equal(Number(zeroAfter.sellingPrice), 0, "zero-price row left exactly as it was");
});

// ---------------------------------------------------------------------------
// 12. Idempotency — cannot double-apply.
// ---------------------------------------------------------------------------

test("re-running the migration does not apply the increase again", async () => {
  const marker = testMarker(); // ONE marker, reused across the whole test — this is what's actually being tested
  const seller = await makeSeller("Rerun");
  const productId = await makeNoVariantProduct(seller.sellerId, {
    customerPrice: { sellingPrice: 100, mrp: 200 },
  });

  const plan1 = await planBulkPriceUpdate([seller], marker);
  assert.equal(plan1.alreadyApplied, false);
  const result1 = await applyBulkPriceUpdate(plan1, "TEST_ACTOR", marker);
  assert.equal(result1.ok, true);

  const afterFirst = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(Number(afterFirst.sellingPrice), 102);

  // A second plan/apply cycle, exactly as a re-run of the CLI script would do.
  const plan2 = await planBulkPriceUpdate([seller], marker);
  assert.equal(plan2.alreadyApplied, true);
  const result2 = await applyBulkPriceUpdate(plan2, "TEST_ACTOR", marker);
  assert.equal(result2.ok, false);

  const afterSecond = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(Number(afterSecond.sellingPrice), 102, "price must NOT have been increased a second time");

  assert.equal(await isBulkPriceUpdateAlreadyApplied(marker), true);
});

// ---------------------------------------------------------------------------
// 13. No intermediate rounding error (also proven at the unit level above;
// this re-proves it end to end through applyBulkPriceUpdate's actual write).
// ---------------------------------------------------------------------------

test("no intermediate rounding error end-to-end: ₹1,000 dealer @ 18%, +3% writes exactly ₹1,030.00", async () => {
  const marker = testMarker();
  const seller = await makeSeller("Precision");
  const productId = await makeNoVariantProduct(seller.sellerId, {
    audience: "DEALER_ONLY",
    taxPercent: 18,
    customerPrice: null,
    dealerPrice: { sellingPrice: 1000, mrp: 1200 },
  });
  const plan = await planBulkPriceUpdate([seller], marker);
  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", marker);
  assert.equal(result.ok, true);
  const config = await prisma.productDealerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(Number(config.sellingPrice), 1030);
});

test("the stored value is exact 2dp decimal text, not a float64 tail (₹9,360 dealer @ 5%, +3% -> ₹9,640.80)", async () => {
  const marker = testMarker();
  const seller = await makeSeller("DecimalWrite");
  // 9360 * 1.03 = 9640.80, whose nearest float64 is 9640.7999999999992724;
  // written as a raw number the pg driver persisted "9640.799999999999".
  // Zero-markdown so the MRP-sync path writes `mrp` too — both must be clean.
  const productId = await makeNoVariantProduct(seller.sellerId, {
    audience: "DEALER_ONLY",
    taxPercent: 5,
    customerPrice: null,
    dealerPrice: { sellingPrice: 9360, mrp: 9360 },
  });
  const plan = await planBulkPriceUpdate([seller], marker);
  assert.equal(plan.mrpSynced.length, 1);
  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", marker);
  assert.equal(result.ok, true);

  const config = await prisma.productDealerConfig.findUniqueOrThrow({ where: { productId } });
  assert.equal(config.sellingPrice.toString(), "9640.8", "no float64 tail in the stored sellingPrice");
  assert.equal(config.mrp.toString(), "9640.8", "no float64 tail in the MRP-synced mrp");
  assert.match(config.sellingPrice.toString(), /^\d+(\.\d{1,2})?$/);
  assert.match(config.mrp.toString(), /^\d+(\.\d{1,2})?$/);
});

// ---------------------------------------------------------------------------
// MRP conflict handling.
//
//  * Zero-markdown conflict (old sellingPrice === old MRP): NOT blocking —
//    apply raises that record's MRP to match the new sellingPrice.
//  * Any other conflict cause (old sellingPrice !== old MRP): still blocks
//    the ENTIRE run, is reported, never auto-resolved.
// ---------------------------------------------------------------------------

test("MRP-sync exception: a zero-markdown conflict (old sellingPrice === old MRP) has its MRP raised to the new price, apply succeeds", async () => {
  const marker = testMarker();
  const seller = await makeSeller("MrpSync");
  // sellingPrice == mrp, 0% tax -> +2% pushes the new price (₹102) past the
  // old MRP (₹100). This is the zero-markdown case: raise MRP, don't block.
  const syncProductId = await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 0,
    customerPrice: { sellingPrice: 100, mrp: 100 },
  });
  // A normal marked-down record in the same run — must come through with its
  // price bumped and its MRP left exactly as it was.
  const fineProductId = await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 18,
    customerPrice: { sellingPrice: 100, mrp: 500 },
  });

  const plan = await planBulkPriceUpdate([seller], marker);
  assert.equal(plan.mrpConflicts.length, 1);
  assert.equal(plan.mrpSynced.length, 1);
  assert.equal(plan.blockingMrpConflicts.length, 0);
  const synced = plan.mrpSynced[0]!;
  assert.equal(synced.productId, syncProductId);
  assert.equal(synced.mrpSyncApplied, true);
  assert.equal(synced.newSellingPrice, 102);
  assert.equal(synced.newMrp, 102, "MRP is raised to exactly the new selling price");
  assert.equal(synced.mrp, 100, "the old MRP is still reported for the audit trail");

  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", marker);
  assert.equal(result.ok, true);

  const syncAfter = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId: syncProductId } });
  assert.equal(Number(syncAfter.sellingPrice), 102);
  assert.equal(Number(syncAfter.mrp), 102, "zero-markdown record's MRP was raised to match");

  const fineAfter = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId: fineProductId } });
  assert.equal(Number(fineAfter.sellingPrice), 102);
  assert.equal(Number(fineAfter.mrp), 500, "a non-conflicting record's MRP is never touched");
});

test("MRP conflict from another cause (old sellingPrice !== old MRP): still blocks the whole run, reported not auto-resolved", async () => {
  const seller = await makeSeller("MrpBlock");
  // sellingPrice (99.5) < mrp (100), but +2% -> ₹101.49 > ₹100. A real
  // conflict, but NOT zero markdown, so the exception must not apply.
  const blockingProductId = await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 0,
    customerPrice: { sellingPrice: 99.5, mrp: 100 },
  });
  const fineProductId = await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 18,
    customerPrice: { sellingPrice: 100, mrp: 500 },
  });

  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.mrpConflicts.length, 1);
  assert.equal(plan.mrpSynced.length, 0, "not zero-markdown — the exception must not fire");
  assert.equal(plan.blockingMrpConflicts.length, 1);
  assert.equal(plan.blockingMrpConflicts[0]!.productId, blockingProductId);
  assert.equal(plan.blockingMrpConflicts[0]!.mrpSyncApplied, false);

  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", testMarker());
  assert.equal(result.ok, false);

  const blockingAfter = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId: blockingProductId } });
  const fineAfter = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId: fineProductId } });
  assert.equal(Number(blockingAfter.sellingPrice), 99.5, "blocking record must be untouched");
  assert.equal(Number(blockingAfter.mrp), 100, "blocking record's MRP must be untouched");
  assert.equal(Number(fineAfter.sellingPrice), 100, "even the non-conflicting record must be untouched — all-or-nothing");
});

test("a blocking conflict still stops a zero-markdown (sync-eligible) record from being written — all-or-nothing", async () => {
  const seller = await makeSeller("MrpMixed");
  // Sync-eligible on its own (100 == 100, +2% -> 102 > 100)...
  const syncEligibleId = await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 0,
    customerPrice: { sellingPrice: 100, mrp: 100 },
  });
  // ...but this blocking conflict in the same run must veto the entire apply.
  await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 0,
    customerPrice: { sellingPrice: 99.5, mrp: 100 },
  });

  const plan = await planBulkPriceUpdate([seller], testMarker());
  assert.equal(plan.mrpSynced.length, 1);
  assert.equal(plan.blockingMrpConflicts.length, 1);

  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", testMarker());
  assert.equal(result.ok, false);

  const syncEligibleAfter = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId: syncEligibleId } });
  assert.equal(Number(syncEligibleAfter.sellingPrice), 100, "sync-eligible record NOT written while a blocking conflict exists");
  assert.equal(Number(syncEligibleAfter.mrp), 100, "sync-eligible record's MRP NOT raised while a blocking conflict exists");
});

test("MRP-sync also applies to a ProductVariant row, not just no-variant configs", async () => {
  const marker = testMarker();
  const seller = await makeSeller("MrpSyncVariant");
  const productId = await makeVariantProduct(seller.sellerId, {
    taxPercent: 5,
    // dealer variant, sellingPrice == mrp -> +3% conflict, zero markdown.
    dealerVariants: [{ sellingPrice: 355, mrp: 355 }],
  });

  const plan = await planBulkPriceUpdate([seller], marker);
  const variantUpdate = plan.updates.find((u) => u.kind === "VARIANT")!;
  assert.equal(variantUpdate.mrpSyncApplied, true);
  assert.equal(variantUpdate.newSellingPrice, 365.65); // 355 * 1.03
  assert.equal(variantUpdate.newMrp, 365.65);

  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", marker);
  assert.equal(result.ok, true);

  const variantAfter = await prisma.productVariant.findFirstOrThrow({ where: { productId } });
  assert.equal(Number(variantAfter.sellingPrice), 365.65);
  assert.equal(Number(variantAfter.mrp), 365.65, "variant MRP raised to match");
});

// ---------------------------------------------------------------------------
// Lifecycle scope — only APPROVED products are ever examined.
// ---------------------------------------------------------------------------

test("an INACTIVE product is never scanned, planned, or written by the migration", async () => {
  const marker = testMarker();
  const seller = await makeSeller("LifecycleScope");
  const approvedId = await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 18,
    customerPrice: { sellingPrice: 100, mrp: 500 },
  });
  const inactiveId = await makeNoVariantProduct(seller.sellerId, {
    audience: "CUSTOMER_ONLY",
    taxPercent: 18,
    customerPrice: { sellingPrice: 100, mrp: 500 },
  });
  await prisma.product.update({ where: { id: inactiveId }, data: { lifecycleStatus: "INACTIVE" } });

  const plan = await planBulkPriceUpdate([seller], marker);
  assert.equal(plan.productsExamined, 1, "only the APPROVED product is examined");
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0]!.productId, approvedId);
  assert.ok(!plan.updates.some((u) => u.productId === inactiveId));

  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", marker);
  assert.equal(result.ok, true);

  const inactiveAfter = await prisma.productCustomerConfig.findUniqueOrThrow({ where: { productId: inactiveId } });
  assert.equal(Number(inactiveAfter.sellingPrice), 100, "INACTIVE product's price is untouched");
});

// ---------------------------------------------------------------------------
// 14. Historical order/settlement data is never touched by this migration.
// ---------------------------------------------------------------------------

test("existing historical order and settlement prices are never modified by this migration", async () => {
  const seller = await makeSeller("Historical");
  const productId = await makeNoVariantProduct(seller.sellerId, {
    customerPrice: { sellingPrice: 100, mrp: 200 },
  });

  // A minimal, directly-inserted OrderItem snapshot standing in for a real
  // historical order — proves this migration's queries never touch
  // OrderItem/SellerOrder at all, only Product*Config/ProductVariant.
  const customer = await prisma.user.create({
    data: {
      phone: `+91903${RUN.toString().slice(-6)}${sellerSuffix}`,
      firstName: "TEST FIXTURE Bulk Price Historical Customer",
      role: "CUSTOMER",
      referralCode: `TESTBPHIST${RUN}${sellerSuffix}`,
    },
  });
  cleanupUserIds.push(customer.id);
  const checkoutGroup = await prisma.checkoutGroup.create({
    data: { groupNumber: `TEST-BP-HIST-${RUN}`, customerId: customer.id, customerType: "CUSTOMER" },
  });
  const sellerOrder = await prisma.sellerOrder.create({
    data: {
      orderNumber: `TEST-BP-HIST-${RUN}-S1`,
      checkoutGroupId: checkoutGroup.id,
      customerId: customer.id,
      sellerId: seller.sellerId,
      customerType: "CUSTOMER",
      status: "DELIVERED",
      paymentMethod: "COD",
      deliveryMethod: "KISAN4U_COURIER",
      subtotal: 100,
      taxAmount: 0,
      totalAmount: 100,
      invoiceNumber: `TEST-BP-HIST-${RUN}-INV`,
    },
  });
  const orderItem = await prisma.orderItem.create({
    data: {
      sellerOrderId: sellerOrder.id,
      productId,
      productName: "Historical snapshot",
      productImageUrl: "/test.jpg",
      sku: "TEST-BP-HIST-SKU",
      quantity: 1,
      unit: "KG",
      unitWeightGrams: 500,
      totalWeightGrams: 500,
      mrp: 200,
      unitPrice: 100,
      taxRatePercent: 18,
      taxAmount: 0,
      subtotal: 100,
    },
  });

  const marker = testMarker();
  const plan = await planBulkPriceUpdate([seller], marker);
  const result = await applyBulkPriceUpdate(plan, "TEST_ACTOR", marker);
  assert.equal(result.ok, true);

  const orderItemAfter = await prisma.orderItem.findUniqueOrThrow({ where: { id: orderItem.id } });
  assert.equal(Number(orderItemAfter.unitPrice), 100, "historical OrderItem.unitPrice must be untouched");
  assert.equal(Number(orderItemAfter.subtotal), 100, "historical OrderItem.subtotal must be untouched");
  const sellerOrderAfter = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrder.id } });
  assert.equal(Number(sellerOrderAfter.totalAmount), 100, "historical SellerOrder.totalAmount must be untouched");

  await prisma.orderItem.delete({ where: { id: orderItem.id } });
  await prisma.sellerOrder.delete({ where: { id: sellerOrder.id } });
  await prisma.checkoutGroup.delete({ where: { id: checkoutGroup.id } });
});

// ---------------------------------------------------------------------------
// resolveSellerByExactName — exact match / ambiguity handling.
// ---------------------------------------------------------------------------

test("resolveSellerByExactName: exact match resolves to that seller's real id", async () => {
  const seller = await makeSeller("ExactMatch");
  const resolved = await resolveSellerByExactName(seller.label);
  assert.equal(resolved.sellerId, seller.sellerId);
});

test("resolveSellerByExactName: a different-case name does NOT match (no fuzzy/case-insensitive matching)", async () => {
  const seller = await makeSeller("CaseSensitive");
  await assert.rejects(() => resolveSellerByExactName(seller.label.toUpperCase()));
});

test("resolveSellerByExactName: throws (refuses) when the name is ambiguous across multiple sellers", async () => {
  const sharedName = `Test Bulk Price Ambiguous ${RUN}`;
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({
      data: {
        email: `test-bulk-price-ambiguous-${RUN}-${i}@example.com`,
        firstName: "TEST FIXTURE Bulk Price Ambiguous",
        role: "SELLER",
        referralCode: `TESTBPAMB${RUN}${i}`,
      },
    });
    cleanupUserIds.push(user.id);
    const seller = await prisma.sellerProfile.create({
      data: { userId: user.id, shopName: sharedName, slug: `test-bp-ambiguous-${RUN}-${i}`, status: "APPROVED" },
    });
    cleanupSellerIds.push(seller.id);
  }
  await assert.rejects(() => resolveSellerByExactName(sharedName));
});
