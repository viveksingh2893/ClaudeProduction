import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseProductVisibility } from "./product-visibility-diagnosis";

const OPEN_ELIGIBILITY = {
  eligibleStateIds: ["s1", "s2"],
  isPanIndia: true,
  blockingRequirements: [],
};
const PARTIAL_ELIGIBILITY = {
  eligibleStateIds: ["s1"],
  isPanIndia: false,
  blockingRequirements: [],
};
const BLOCKED_ELIGIBILITY = {
  eligibleStateIds: [],
  isPanIndia: false,
  blockingRequirements: [
    { requirementId: "r1", name: "Import Licence", status: "MISSING" as const },
  ],
};

const BASE_PRODUCT = {
  lifecycleStatus: "APPROVED" as const,
  audience: "BOTH_CUSTOMER_AND_DEALER" as const,
  customerVisible: true,
  dealerVisible: true,
};

test("a non-approved product is hidden from every audience with its exact status named", () => {
  const d = diagnoseProductVisibility(
    { ...BASE_PRODUCT, lifecycleStatus: "DRAFT" },
    "customer",
    OPEN_ELIGIBILITY,
  );
  assert.equal(d.visibleInCatalogue, false);
  assert.equal(d.purchasable, false);
  assert.match(d.reason!, /DRAFT/);
});

test("a DEALER_ONLY product is hidden from Customer with the audience named as the reason", () => {
  const d = diagnoseProductVisibility(
    { ...BASE_PRODUCT, audience: "DEALER_ONLY" },
    "customer",
    OPEN_ELIGIBILITY,
  );
  assert.equal(d.visibleInCatalogue, false);
  assert.match(d.reason!, /Dealer only/);
});

test("a CUSTOMER_ONLY product is hidden from Dealer with the audience named as the reason", () => {
  const d = diagnoseProductVisibility(
    { ...BASE_PRODUCT, audience: "CUSTOMER_ONLY" },
    "dealer",
    OPEN_ELIGIBILITY,
  );
  assert.equal(d.visibleInCatalogue, false);
  assert.match(d.reason!, /Customer only/);
});

test("a fully licence-blocked audience is hidden and names the blocking requirement", () => {
  const d = diagnoseProductVisibility(
    { ...BASE_PRODUCT, dealerVisible: false },
    "dealer",
    BLOCKED_ELIGIBILITY,
  );
  assert.equal(d.visibleInCatalogue, false);
  assert.equal(d.purchasable, false);
  assert.match(d.reason!, /Import Licence/);
});

test("a Pan-India-eligible, fully-visible audience is purchasable with no reason needed", () => {
  const d = diagnoseProductVisibility(BASE_PRODUCT, "customer", OPEN_ELIGIBILITY);
  assert.equal(d.visibleInCatalogue, true);
  assert.equal(d.purchasable, true);
  assert.equal(d.reason, null);
});

test("a state-restricted but visible audience is purchasable, with a states-scoped reason", () => {
  const d = diagnoseProductVisibility(BASE_PRODUCT, "dealer", PARTIAL_ELIGIBILITY);
  assert.equal(d.visibleInCatalogue, true);
  assert.equal(d.purchasable, true);
  assert.match(d.reason!, /states listed above/);
});

test("visibleFlag true but eligibility computes zero states is flagged as stale rather than silently purchasable", () => {
  const d = diagnoseProductVisibility(BASE_PRODUCT, "customer", {
    eligibleStateIds: [],
    isPanIndia: false,
    blockingRequirements: [],
  });
  assert.equal(d.visibleInCatalogue, true);
  assert.equal(d.purchasable, false);
  assert.match(d.reason!, /stale/);
});
