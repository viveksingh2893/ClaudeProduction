import { test } from "node:test";
import assert from "node:assert/strict";
import { isProductAvailableForState, redactDealerPricingIfUnavailable } from "./availability";

test("a product with no availableStates rows is available everywhere", () => {
  assert.equal(isProductAvailableForState([], "state-a"), true);
  assert.equal(isProductAvailableForState([], null), true);
});

test("a product restricted to specific states is only available for a matching stateId", () => {
  const states = [{ id: "state-a" }, { id: "state-b" }];
  assert.equal(isProductAvailableForState(states, "state-a"), true);
  assert.equal(isProductAvailableForState(states, "state-c"), false);
  assert.equal(isProductAvailableForState(states, null), false);
});

test("redactDealerPricingIfUnavailable leaves an available product untouched", () => {
  const product = {
    availableInState: true,
    dealerConfig: { mrp: 100, sellingPrice: 90 },
    variants: [{ mrp: 50, sellingPrice: 45, sku: "V1" }],
  };
  const result = redactDealerPricingIfUnavailable(product);
  assert.equal(result.dealerConfig?.mrp, 100);
  assert.equal(result.dealerConfig?.sellingPrice, 90);
  assert.equal(result.variants[0]!.mrp, 50);
  assert.equal(result.variants[0]!.sellingPrice, 45);
});

test("redactDealerPricingIfUnavailable strips mrp/sellingPrice for a state-unavailable product, on both dealerConfig and every variant, without dropping other fields", () => {
  const product = {
    availableInState: false,
    dealerConfig: { mrp: 100, sellingPrice: 90, minOrderQty: 5 },
    variants: [
      { mrp: 50, sellingPrice: 45, sku: "V1" },
      { mrp: 70, sellingPrice: 60, sku: "V2" },
    ],
  };
  const result = redactDealerPricingIfUnavailable(product);
  assert.equal(result.dealerConfig?.mrp, null);
  assert.equal(result.dealerConfig?.sellingPrice, null);
  assert.equal(result.dealerConfig?.minOrderQty, 5);
  assert.equal(result.variants[0]!.mrp, null);
  assert.equal(result.variants[0]!.sellingPrice, null);
  assert.equal(result.variants[0]!.sku, "V1");
  assert.equal(result.variants[1]!.mrp, null);
  assert.equal(result.variants[1]!.sku, "V2");
});

test("redactDealerPricingIfUnavailable handles a null dealerConfig without throwing", () => {
  const product = {
    availableInState: false,
    dealerConfig: null,
    variants: [{ mrp: 10, sellingPrice: 8 }],
  };
  const result = redactDealerPricingIfUnavailable(product);
  assert.equal(result.dealerConfig, null);
  assert.equal(result.variants[0]!.mrp, null);
});
