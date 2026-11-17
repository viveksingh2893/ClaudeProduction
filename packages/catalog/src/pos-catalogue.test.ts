/**
 * Integration tests against the real dev Postgres — same throwaway-
 * fixture convention as dealer-catalogue.test.ts. Covers the two new
 * POS-specific catalogue queries (searchCustomerCatalogueForPos /
 * searchDealerCatalogueForPos): audience isolation (a dealer must never
 * see a customer-only product or vice versa), price isolation (the same
 * BOTH-audience product must show a different price per audience), SKU
 * search, and the `availableOnly` filter for a dealer.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { searchCustomerCatalogueForPos, searchDealerCatalogueForPos } from "./queries";

const RUN = Date.now();
let sellerId: string;
let categoryId: string;
let stateId: string;
let bothAudienceProductId: string;
let customerOnlyProductId: string;
let dealerOnlyOutOfStateProductId: string;
let skuSearchProductId: string;
let variantSkuProductId: string;

before(async () => {
  const seller = await prisma.sellerProfile.findFirstOrThrow({ where: { status: "APPROVED" } });
  sellerId = seller.id;
  const category = await prisma.category.findFirstOrThrow({
    where: { name: { not: { startsWith: "TEST FIXTURE" } } },
  });
  categoryId = category.id;
  const state = await prisma.indianState.findFirstOrThrow({ where: { isActive: true } });
  stateId = state.id;

  const base = {
    sellerId,
    categoryId,
    hsnCode: "000000",
    shortDescription: "POS catalogue test fixture",
    description: "POS catalogue test fixture",
    productType: "PHYSICAL" as const,
    baseUnit: "PIECE" as const,
    packageSize: "1 piece",
    primaryImageUrl: "/test/fixture.jpg",
    lifecycleStatus: "APPROVED" as const,
  };

  const both = await prisma.product.create({
    data: {
      ...base,
      name: `TEST FIXTURE PosCatalogue Both ${RUN}`,
      slug: `test-fixture-poscat-both-${RUN}`,
      sku: `TEST-POSCAT-BOTH-${RUN}`,
      audience: "BOTH_CUSTOMER_AND_DEALER",
      dealerVisible: true,
      customerVisible: true,
      customerConfig: { create: { mrp: 500, sellingPrice: 400 } },
      dealerConfig: { create: { mrp: 500, sellingPrice: 250, currentStock: 50 } },
    },
  });
  bothAudienceProductId = both.id;

  const customerOnly = await prisma.product.create({
    data: {
      ...base,
      name: `TEST FIXTURE PosCatalogue CustomerOnly ${RUN}`,
      slug: `test-fixture-poscat-customer-${RUN}`,
      sku: `TEST-POSCAT-CUSTOMER-${RUN}`,
      audience: "CUSTOMER_ONLY",
      dealerVisible: false,
      customerVisible: true,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  customerOnlyProductId = customerOnly.id;

  const dealerOnlyOutOfState = await prisma.product.create({
    data: {
      ...base,
      name: `TEST FIXTURE PosCatalogue DealerOutOfState ${RUN}`,
      slug: `test-fixture-poscat-dealeroos-${RUN}`,
      sku: `TEST-POSCAT-DEALEROOS-${RUN}`,
      audience: "DEALER_ONLY",
      dealerVisible: true,
      customerVisible: false,
      dealerConfig: { create: { mrp: 100, sellingPrice: 100, currentStock: 10 } },
      // Restricted to a state that is deliberately NOT the dealer's state used below.
      dealerAvailableStates: {
        connect: [
          {
            id: (await prisma.indianState.findFirstOrThrow({ where: { id: { not: stateId } } })).id,
          },
        ],
      },
    },
  });
  dealerOnlyOutOfStateProductId = dealerOnlyOutOfState.id;

  const skuProduct = await prisma.product.create({
    data: {
      ...base,
      name: `TEST FIXTURE PosCatalogue SkuSearch ${RUN}`,
      slug: `test-fixture-poscat-sku-${RUN}`,
      sku: `POSSKU-UNIQUE-${RUN}`,
      audience: "CUSTOMER_ONLY",
      dealerVisible: false,
      customerVisible: true,
      customerConfig: { create: { mrp: 100, sellingPrice: 100 } },
    },
  });
  skuSearchProductId = skuProduct.id;

  const variantProduct = await prisma.product.create({
    data: {
      ...base,
      name: `TEST FIXTURE PosCatalogue VariantSku ${RUN}`,
      slug: `test-fixture-poscat-varsku-${RUN}`,
      sku: `TEST-POSCAT-VARSKU-${RUN}`,
      audience: "CUSTOMER_ONLY",
      dealerVisible: false,
      customerVisible: true,
      variants: {
        create: [
          {
            audience: "CUSTOMER",
            sku: `POSVARSKU-UNIQUE-${RUN}`,
            combinationKey: "default",
            mrp: 100,
            sellingPrice: 100,
            minOrderQty: 1,
            stockQty: 10,
            isActive: true,
            isDefault: true,
          },
        ],
      },
    },
  });
  variantSkuProductId = variantProduct.id;
});

after(async () => {
  const productIds = [
    bothAudienceProductId,
    customerOnlyProductId,
    dealerOnlyOutOfStateProductId,
    skuSearchProductId,
    variantSkuProductId,
  ];
  await prisma.productVariant.deleteMany({ where: { productId: variantSkuProductId } });
  await prisma.productDealerConfig.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.productCustomerConfig.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
});

test("searchCustomerCatalogueForPos: never returns a DEALER_ONLY product, and returns customer pricing for a BOTH-audience product", async () => {
  const result = await searchCustomerCatalogueForPos({
    search: `TEST FIXTURE PosCatalogue`,
    pageSize: 50,
  });
  const ids = result.rows.map((r) => r.id);
  assert.ok(ids.includes(bothAudienceProductId));
  assert.ok(ids.includes(customerOnlyProductId));
  assert.ok(
    !ids.includes(dealerOnlyOutOfStateProductId),
    "a DEALER_ONLY product must never appear in the customer/customer catalogue",
  );

  const both = result.rows.find((r) => r.id === bothAudienceProductId)!;
  assert.equal(
    Number(both.customerConfig!.sellingPrice),
    400,
    "must show the customer/customer price, not the dealer price",
  );
});

test("searchDealerCatalogueForPos: never returns a CUSTOMER_ONLY product, and returns dealer pricing (different from the customer price) for a BOTH-audience product", async () => {
  const result = await searchDealerCatalogueForPos(stateId, {
    search: `TEST FIXTURE PosCatalogue`,
    pageSize: 50,
  });
  const ids = result.rows.map((r) => r.id);
  assert.ok(ids.includes(bothAudienceProductId));
  assert.ok(
    ids.includes(dealerOnlyOutOfStateProductId),
    "still returned, just flagged unavailable — never omitted",
  );
  assert.ok(
    !ids.includes(customerOnlyProductId),
    "a CUSTOMER_ONLY product must never appear in the dealer catalogue",
  );

  const both = result.rows.find((r) => r.id === bothAudienceProductId)!;
  assert.equal(
    Number(both.dealerConfig!.sellingPrice),
    250,
    "must show the dealer price, distinct from the customer price (400) for the same product",
  );

  const outOfState = result.rows.find((r) => r.id === dealerOnlyOutOfStateProductId)!;
  assert.equal(outOfState.availableInState, false);
});

test("searchDealerCatalogueForPos availableOnly=true drops the out-of-state product but keeps the in-stock available one", async () => {
  const result = await searchDealerCatalogueForPos(stateId, {
    search: `TEST FIXTURE PosCatalogue`,
    availableOnly: true,
    pageSize: 50,
  });
  const ids = result.rows.map((r) => r.id);
  assert.ok(ids.includes(bothAudienceProductId), "available, in-stock product must remain");
  assert.ok(
    !ids.includes(dealerOnlyOutOfStateProductId),
    "out-of-state product must be dropped by availableOnly",
  );
});

test("search matches a product's own SKU", async () => {
  const result = await searchCustomerCatalogueForPos({ search: `POSSKU-UNIQUE-${RUN}` });
  assert.ok(result.rows.some((r) => r.id === skuSearchProductId));
});

test("search matches a variant's SKU, not just the base product's own SKU", async () => {
  const result = await searchCustomerCatalogueForPos({ search: `POSVARSKU-UNIQUE-${RUN}` });
  assert.ok(
    result.rows.some((r) => r.id === variantSkuProductId),
    "searching a variant SKU must surface its parent product",
  );
});

test("pagination: total reflects the full match count regardless of pageSize", async () => {
  const page1 = await searchCustomerCatalogueForPos({
    search: `TEST FIXTURE PosCatalogue`,
    page: 1,
    pageSize: 1,
  });
  assert.equal(page1.rows.length, 1);
  assert.ok(page1.total >= 2, "total must count all matches, not just the returned page");
});
