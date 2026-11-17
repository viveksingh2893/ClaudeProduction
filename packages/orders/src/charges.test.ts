import { test } from "node:test";
import assert from "node:assert/strict";
import { determineChargeResponsibility } from "./charges";

test("customer courier transportation is always seller-borne", () => {
  const result = determineChargeResponsibility("CUSTOMER", "KISAN4U_COURIER");
  assert.equal(result.transportationPayer, "SELLER");
});

test("dealer Kisan4U Courier transportation is dealer (customer) paid", () => {
  const result = determineChargeResponsibility("DEALER", "KISAN4U_COURIER");
  assert.equal(result.transportationPayer, "CUSTOMER");
});

test("dealer Transport transportation is also dealer (customer) paid — corrective fix, no longer a silent seller/no-charge placeholder", () => {
  const result = determineChargeResponsibility("DEALER", "TRANSPORT");
  assert.equal(result.transportationPayer, "CUSTOMER");
});

// Collection charge itself (always seller-borne, independent of these
// branches), the collection-charge formula boundary values, and dealer
// Transport pricing-source resolution are all exercised via the DB
// integration tests in charges-integration.test.ts and
// phase4-security.test.ts — there is no separate branching logic for them
// here to unit test.
