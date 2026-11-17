/**
 * Pure unit tests (no database) for translateGroupToSubmissionInput's
 * shape-conversion logic — the MRP/Selling-Price -> FLAT-discount
 * derivation, the display-unit -> storage-unit conversions (weight
 * G/KG -> grams, dimensions CM/M -> metres), the digital-product field
 * stripping, and the variant-product placeholder config. These are the
 * parts of the translator most likely to silently produce a wrong number
 * without ever failing validation, so they're worth pinning directly
 * rather than only exercising indirectly through the DB integration
 * tests in bulk-product-submission.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBulkGroupSharedData, parseBulkRowData } from "@kisan4u/validators";
import { translateGroupToSubmissionInput } from "./bulk-product-submission";

function row(
  audience: "CUSTOMER" | "DEALER",
  data: Parameters<typeof parseBulkRowData>[0],
  existingVariantId: string | null = null,
) {
  return { audience, data: parseBulkRowData(data), existingVariantId };
}

test("derives a FLAT discount of exactly (mrp - sellingPrice) for a non-variant customer config", () => {
  const shared = parseBulkGroupSharedData({
    name: "Widget",
    categoryId: "cat1",
    baseUnit: "PIECE",
    audience: "CUSTOMER_ONLY",
  });
  const rows = [row("CUSTOMER", { skuBase: "WID", mrp: "150", sellingPrice: "120" })];
  const out = translateGroupToSubmissionInput("GRP-1", shared, rows);
  assert.equal(out.customerConfig?.mrp, 150);
  assert.equal(out.customerConfig?.discountType, "FLAT");
  assert.equal(out.customerConfig?.discountValue, 30);
});

test("clamps a discount derivation to zero rather than going negative when sellingPrice > mrp", () => {
  const shared = parseBulkGroupSharedData({ name: "Widget", categoryId: "cat1", audience: "CUSTOMER_ONLY" });
  const rows = [row("CUSTOMER", { skuBase: "WID", mrp: "100", sellingPrice: "140" })];
  const out = translateGroupToSubmissionInput("GRP-1", shared, rows);
  assert.equal(out.customerConfig?.discountValue, 0);
});

test("converts KG to grams and leaves G as-is", () => {
  const shared = parseBulkGroupSharedData({ name: "Widget", categoryId: "cat1", audience: "CUSTOMER_ONLY" });
  const kgRows = [row("CUSTOMER", { skuBase: "WID", mrp: "10", sellingPrice: "10", weight: "2.5", weightUnit: "KG" })];
  const kgOut = translateGroupToSubmissionInput("GRP-1", shared, kgRows);
  assert.equal(kgOut.customerConfig?.weight, 2500);

  const gRows = [row("CUSTOMER", { skuBase: "WID", mrp: "10", sellingPrice: "10", weight: "350", weightUnit: "G" })];
  const gOut = translateGroupToSubmissionInput("GRP-1", shared, gRows);
  assert.equal(gOut.customerConfig?.weight, 350);
});

test("converts CM to metres and leaves M as-is for dimensions", () => {
  const shared = parseBulkGroupSharedData({ name: "Widget", categoryId: "cat1", audience: "CUSTOMER_ONLY" });
  const cmRows = [
    row("CUSTOMER", {
      skuBase: "WID",
      mrp: "10",
      sellingPrice: "10",
      height: "50",
      breadth: "20",
      length: "10",
      dimensionUnit: "CM",
    }),
  ];
  const cmOut = translateGroupToSubmissionInput("GRP-1", shared, cmRows);
  assert.equal(cmOut.customerConfig?.height, 0.5);
  assert.equal(cmOut.customerConfig?.breadth, 0.2);
  assert.equal(cmOut.customerConfig?.length, 0.1);

  const mRows = [
    row("CUSTOMER", {
      skuBase: "WID",
      mrp: "10",
      sellingPrice: "10",
      height: "1.2",
      dimensionUnit: "M",
    }),
  ];
  const mOut = translateGroupToSubmissionInput("GRP-1", shared, mRows);
  assert.equal(mOut.customerConfig?.height, 1.2);
});

test("strips weight/dimensions for a digital product even when the row carries values", () => {
  const shared = parseBulkGroupSharedData({
    name: "E-book",
    categoryId: "cat1",
    audience: "CUSTOMER_ONLY",
    productType: "DIGITAL",
  });
  const rows = [
    row("CUSTOMER", {
      skuBase: "EBK",
      mrp: "10",
      sellingPrice: "10",
      weight: "500",
      height: "10",
      breadth: "10",
      length: "10",
    }),
  ];
  const out = translateGroupToSubmissionInput("GRP-1", shared, rows);
  assert.equal(out.customerConfig?.weight, undefined);
  assert.equal(out.customerConfig?.height, undefined);
  assert.equal(out.customerConfig?.breadth, undefined);
  assert.equal(out.customerConfig?.length, undefined);
});

test("a dealer row with shippingIncluded NO maps to EXCLUDE_WITH_PRODUCT", () => {
  const shared = parseBulkGroupSharedData({ name: "Widget", categoryId: "cat1", audience: "DEALER_ONLY" });
  const rows = [row("DEALER", { skuBase: "WID", mrp: "10", sellingPrice: "10", shippingIncluded: "NO" })];
  const out = translateGroupToSubmissionInput("GRP-1", shared, rows);
  assert.equal(out.dealerConfig?.shippingCalcMode, "EXCLUDE_WITH_PRODUCT");
});

test("a variant product gets a zero-stock placeholder base config for each needed audience, never the real inventory", () => {
  const shared = parseBulkGroupSharedData({
    name: "Shirt",
    categoryId: "cat1",
    audience: "BOTH_CUSTOMER_AND_DEALER",
    hasVariants: "YES",
  });
  const rows = [
    row("CUSTOMER", {
      skuBase: "SHIRT-L",
      hsnCode: "610910",
      mrp: "500",
      sellingPrice: "450",
      taxPercent: "12",
      currentStock: "15",
    }),
    row("DEALER", {
      skuBase: "SHIRT-L",
      hsnCode: "610910",
      mrp: "480",
      sellingPrice: "400",
      taxPercent: "12",
      currentStock: "60",
    }),
  ];
  const out = translateGroupToSubmissionInput("GRP-shirt", shared, rows);
  assert.equal(out.customerConfig?.currentStock, 0, "placeholder base config must never carry real stock");
  assert.equal(out.dealerConfig?.currentStock, 0);
  assert.equal(out.customerConfig?.hsnCode, "610910", "placeholder mirrors the sample row's HSN");
  assert.equal(out.taxPercent, 12, "single product-level tax rate, taken from the first row");
  assert.equal(out.customerVariants?.length, 1);
  assert.equal(out.dealerVariants?.length, 1);
  assert.equal(out.customerVariants?.[0]?.stockQty, 15, "the real stock lives on the variant, not the base config");
});

test("passes existingVariantId through as the variant input's id so an update targets the same row", () => {
  const shared = parseBulkGroupSharedData({
    name: "Shirt",
    categoryId: "cat1",
    audience: "CUSTOMER_ONLY",
    hasVariants: "YES",
  });
  const rows = [row("CUSTOMER", { skuBase: "SHIRT-L", mrp: "500", sellingPrice: "450" }, "variant-123")];
  const out = translateGroupToSubmissionInput("GRP-shirt", shared, rows);
  assert.equal(out.customerVariants?.[0]?.id, "variant-123");
});

test("leaves the SKU untouched at translation time — the -cus/-dea suffix is applied later by productSubmissionSchema, not duplicated here", () => {
  const shared = parseBulkGroupSharedData({ name: "Widget", categoryId: "cat1", audience: "CUSTOMER_ONLY" });
  const rows = [row("CUSTOMER", { skuBase: "WID-BASE", mrp: "10", sellingPrice: "10" })];
  const out = translateGroupToSubmissionInput("GRP-1", shared, rows);
  assert.equal(out.customerConfig?.sku, "WID-BASE");
});
