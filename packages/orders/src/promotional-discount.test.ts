import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getCustomerPromoDiscountPercent,
  calculateCustomerPromoDiscount,
} from "./promotional-discount";

test("customer full online payment gets exactly 5%", () => {
  assert.equal(getCustomerPromoDiscountPercent("CUSTOMER", "ONLINE_FULL"), 5);
});

test("customer partial online payment gets exactly 2%", () => {
  assert.equal(getCustomerPromoDiscountPercent("CUSTOMER", "ONLINE_PARTIAL"), 2);
});

test("customer COD gets 0%", () => {
  assert.equal(getCustomerPromoDiscountPercent("CUSTOMER", "COD"), 0);
});

test("customer WALLET gets 0% — never assumed to be full online", () => {
  assert.equal(getCustomerPromoDiscountPercent("CUSTOMER", "WALLET"), 0);
});

test("dealer gets 0% for every payment method", () => {
  for (const method of [
    "COD",
    "ONLINE_FULL",
    "ONLINE_PARTIAL",
    "WALLET",
    "TRANSPORT_FULL_ONLINE",
  ] as const) {
    assert.equal(
      getCustomerPromoDiscountPercent("DEALER", method),
      0,
      `dealer + ${method} must be 0%`,
    );
  }
});

test("single seller order: 5% of merchandise value, Kisan4u is the payer", () => {
  const result = calculateCustomerPromoDiscount("CUSTOMER", "ONLINE_FULL", [1000]);
  assert.equal(result.percent, 5);
  assert.equal(result.checkoutLevelDiscountAmount, 50);
  assert.equal(result.perSeller[0]!.discountAmount, 50);
});

test("dealer order: allocation is always zero regardless of subtotal split", () => {
  const result = calculateCustomerPromoDiscount("DEALER", "ONLINE_FULL", [1200, 800]);
  assert.equal(result.checkoutLevelDiscountAmount, 0);
  assert.deepEqual(
    result.perSeller.map((p) => p.discountAmount),
    [0, 0],
  );
});

test("multi-seller allocation sums exactly to the checkout-level discount, no paisa lost to rounding", () => {
  // 3 sellers with values chosen so independent per-seller rounding would
  // drift by a paisa if computed naively.
  const values = [333.33, 333.33, 333.34];
  const result = calculateCustomerPromoDiscount("CUSTOMER", "ONLINE_PARTIAL", values);
  const sumOfShares = result.perSeller.reduce(
    (total, p) => Math.round((total + p.discountAmount) * 100) / 100,
    0,
  );
  assert.equal(sumOfShares, result.checkoutLevelDiscountAmount);
  assert.equal(result.percent, 2);
});

test("multi-seller allocation with many sellers still sums exactly", () => {
  const values = Array.from({ length: 11 }, () => 90.91); // deliberately not evenly divisible
  const result = calculateCustomerPromoDiscount("CUSTOMER", "ONLINE_FULL", values);
  const sumOfShares = result.perSeller.reduce(
    (total, p) => Math.round((total + p.discountAmount) * 100) / 100,
    0,
  );
  assert.equal(sumOfShares, result.checkoutLevelDiscountAmount);
});

test("empty cart returns zero discount and an empty allocation list", () => {
  const result = calculateCustomerPromoDiscount("CUSTOMER", "ONLINE_FULL", []);
  assert.equal(result.checkoutLevelDiscountAmount, 0);
  assert.deepEqual(result.perSeller, []);
});
