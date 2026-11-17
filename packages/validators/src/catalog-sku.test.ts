/** Pure function tests, no DB — normalizeAudienceSku (spec item #4's "-cus"/"-dea" convention). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAudienceSku } from "./catalog";

test("a SKU with no suffix gets the correct suffix appended", () => {
  const customer = normalizeAudienceSku("ABC-RED-L", "CUSTOMER");
  assert.equal(customer.ok, true);
  assert.equal(customer.ok && customer.sku, "ABC-RED-L-cus");

  const dealer = normalizeAudienceSku("ABC-RED-L", "DEALER");
  assert.equal(dealer.ok, true);
  assert.equal(dealer.ok && dealer.sku, "ABC-RED-L-dea");
});

test("a SKU already ending in its own correct suffix is returned unchanged (never double-suffixed)", () => {
  const result = normalizeAudienceSku("ABC-RED-L-cus", "CUSTOMER");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.sku, "ABC-RED-L-cus");
});

test("re-normalizing an already-normalized SKU is idempotent", () => {
  const first = normalizeAudienceSku("ABC-RED-L", "DEALER");
  assert.ok(first.ok);
  const second = normalizeAudienceSku(first.ok ? first.sku : "", "DEALER");
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.sku, "ABC-RED-L-dea");
});

test("a SKU ending in the OTHER audience's suffix is rejected, not silently rewritten", () => {
  const result = normalizeAudienceSku("ABC-RED-L-dea", "CUSTOMER");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && /dea/.test(result.error));

  const reverse = normalizeAudienceSku("ABC-RED-L-cus", "DEALER");
  assert.equal(reverse.ok, false);
});

test("suffix casing is normalized even though the base is preserved as typed", () => {
  const result = normalizeAudienceSku("ABC-RED-L-CUS", "CUSTOMER");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.sku, "ABC-RED-L-cus");
});

test("an empty or whitespace-only SKU is rejected", () => {
  assert.equal(normalizeAudienceSku("", "CUSTOMER").ok, false);
  assert.equal(normalizeAudienceSku("   ", "DEALER").ok, false);
});

test("whitespace around an otherwise-valid SKU is trimmed", () => {
  const result = normalizeAudienceSku("  ABC-RED-L  ", "CUSTOMER");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.sku, "ABC-RED-L-cus");
});
