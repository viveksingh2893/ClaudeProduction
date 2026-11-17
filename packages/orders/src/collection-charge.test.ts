/**
 * Integration tests against the real dev Postgres (same connection
 * seed.ts uses) — assumes an active CollectionChargeConfig already exists
 * (seed.ts now seeds "higher of ₹30 flat or 1.5%"), same convention as
 * phase4-security.test.ts. Does not mutate that shared config.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCollectionCharge } from "./charges";

test("₹0 order: 1.5% of 0 is 0, so the ₹30 flat minimum applies", async () => {
  const result = await calculateCollectionCharge(0);
  assert.equal(result.finalCharge, 30);
  assert.equal(result.payer, "SELLER");
});

test("₹1 order: 1.5% is ₹0.015, the ₹30 flat minimum applies", async () => {
  const result = await calculateCollectionCharge(1);
  assert.equal(result.finalCharge, 30);
});

test("₹1,000 order gives ₹30 (1.5% = ₹15, below the ₹30 minimum)", async () => {
  const result = await calculateCollectionCharge(1000);
  assert.equal(result.percentageResult, 15);
  assert.equal(result.finalCharge, 30);
});

test("₹1,999 order: 1.5% = ₹29.985, still below ₹30 — the flat minimum applies", async () => {
  const result = await calculateCollectionCharge(1999);
  assert.ok(result.percentageResult < 30);
  assert.equal(result.finalCharge, 30);
});

test("₹2,000 order: 1.5% is exactly ₹30, matching the flat minimum at the crossover", async () => {
  const result = await calculateCollectionCharge(2000);
  assert.equal(result.percentageResult, 30);
  assert.equal(result.finalCharge, 30);
});

test("₹2,001 order: 1.5% = ₹30.015, now above the ₹30 minimum — the percentage applies", async () => {
  const result = await calculateCollectionCharge(2001);
  assert.equal(result.finalCharge, 30.02); // 30.015 rounded half-up to 2dp
  assert.ok(result.finalCharge > 30);
});

test("₹3,000 order gives ₹45 (1.5% = ₹45, above the ₹30 minimum)", async () => {
  const result = await calculateCollectionCharge(3000);
  assert.equal(result.percentageResult, 45);
  assert.equal(result.finalCharge, 45);
});

test("decimal/paise values round correctly (no JS float drift)", async () => {
  const result = await calculateCollectionCharge(2345.67);
  // 2345.67 * 1.5 / 100 = 35.18505 -> rounds to 35.19 (half-up)
  assert.equal(result.percentageResult, 35.19);
  assert.equal(result.finalCharge, 35.19);
});

test("collection charge is computed independently per seller order, not once for the whole multi-seller cart", async () => {
  const sellerA = await calculateCollectionCharge(1000); // -> 30
  const sellerB = await calculateCollectionCharge(3000); // -> 45
  const combinedIfComputedOnce = await calculateCollectionCharge(4000); // -> 60 (1.5% of 4000)
  assert.equal(sellerA.finalCharge + sellerB.finalCharge, 75);
  assert.notEqual(sellerA.finalCharge + sellerB.finalCharge, combinedIfComputedOnce.finalCharge);
});

test("formula snapshot records the seller-order value, percentage, minimum, and result used", async () => {
  const result = await calculateCollectionCharge(5000);
  assert.equal(result.sellerOrderValue, 5000);
  assert.equal(result.percentageUsed, 1.5);
  assert.equal(result.minimumCharge, 30);
  assert.ok(result.formula.includes("1.5%"));
  assert.ok(result.formula.includes("30"));
});
