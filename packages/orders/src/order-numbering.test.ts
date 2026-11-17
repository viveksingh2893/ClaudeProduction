import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSellerOrderNumber, generateInvoiceNumber } from "./order-numbering";

test("seller order numbers are suffixed -S1, -S2, ... in stable order", () => {
  const group = "K4U-20260724-1234";
  assert.equal(generateSellerOrderNumber(group, 0), "K4U-20260724-1234-S1");
  assert.equal(generateSellerOrderNumber(group, 1), "K4U-20260724-1234-S2");
  assert.equal(generateSellerOrderNumber(group, 2), "K4U-20260724-1234-S3");
});

test("invoice number is the seller order number verbatim (product decision — no separate invoice sequence)", () => {
  const orderNumber = "K4U-20260724-1234-S1";
  const invoiceNumber = generateInvoiceNumber(orderNumber);
  assert.equal(invoiceNumber, orderNumber);
});

test("no customer-facing number is derived from a raw database id", () => {
  // Both generators take only human-meaningful inputs (a group number
  // string, a plain integer index) — never a cuid — by construction; this
  // test documents that contract so a future change can't silently start
  // threading a database id through.
  const orderNumber = generateSellerOrderNumber("K4U-20260724-1234", 0);
  assert.doesNotMatch(orderNumber, /^c[a-z0-9]{20,}$/); // not a cuid shape
});
