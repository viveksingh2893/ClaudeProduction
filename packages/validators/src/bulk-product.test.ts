/** Pure schema tests, no DB — bulk-product draft payload parsing (permissive by design; see bulk-product.ts's doc comment). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBulkGroupSharedData, parseBulkRowData } from "./bulk-product";

test("an empty/incomplete group payload parses to safe defaults instead of throwing (a draft is allowed to be incomplete)", () => {
  const parsed = parseBulkGroupSharedData({});
  assert.equal(parsed.name, "");
  assert.equal(parsed.hasVariants, "NO");
  assert.equal(parsed.productType, "PHYSICAL");
  assert.deepEqual(parsed.attributeValues, []);
  assert.deepEqual(parsed.customerStateIds, []);
});

test("a partially-filled group payload keeps the provided fields and defaults the rest", () => {
  const parsed = parseBulkGroupSharedData({
    name: "Cotton Shirt",
    hasVariants: "YES",
    selectedAttributeIds: ["attr_color", "attr_size"],
  });
  assert.equal(parsed.name, "Cotton Shirt");
  assert.equal(parsed.hasVariants, "YES");
  assert.deepEqual(parsed.selectedAttributeIds, ["attr_color", "attr_size"]);
  assert.equal(parsed.categoryId, "");
});

test("an empty row payload parses to safe defaults", () => {
  const parsed = parseBulkRowData({});
  assert.equal(parsed.skuBase, "");
  assert.equal(parsed.minOrderQty, "1");
  assert.equal(parsed.minStockQty, "5");
  assert.equal(parsed.reorderLevel, "10");
  assert.equal(parsed.shippingIncluded, "YES");
  assert.equal(parsed.isActive, true);
});

test("null/undefined input is treated the same as an empty object", () => {
  assert.deepEqual(parseBulkGroupSharedData(undefined), parseBulkGroupSharedData({}));
  assert.deepEqual(parseBulkRowData(null), parseBulkRowData({}));
});

test("a row's attributeValueRefs must still be well-formed {attributeId, slug} pairs even though the row itself is permissive", () => {
  assert.throws(() => parseBulkRowData({ attributeValueRefs: [{ attributeId: "" }] }));
  const ok = parseBulkRowData({
    attributeValueRefs: [{ attributeId: "attr_color", slug: "red" }],
  });
  assert.deepEqual(ok.attributeValueRefs, [{ attributeId: "attr_color", slug: "red" }]);
});
