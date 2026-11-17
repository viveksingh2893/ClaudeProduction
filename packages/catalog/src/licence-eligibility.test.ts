/**
 * Pure-function tests for evaluateEligibilityForPath — no database
 * involved. Fixtures build a SellerLicenceEligibilityIndex by hand (the
 * exact shape buildSellerLicenceEligibilityIndex would produce from real
 * rows), so this exercises the hierarchy/AND-logic/audience/geography
 * matrix directly and fast. Database-touching behavior (expiry-at-read-
 * time, the requirement/submission CRUD+versioning, compliance
 * reconciliation) is covered separately in licence-lifecycle.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEligibilityForPath,
  explainBlockedState,
  type SellerLicenceEligibilityIndex,
} from "./licence-eligibility";

type Req = {
  id: string;
  taxonomyNodeType: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
  taxonomyNodeId: string;
  name: string;
  customerRequired: boolean;
  customerGeoType: "PAN_INDIA" | "STATE_WISE" | null;
  dealerRequired: boolean;
  dealerGeoType: "PAN_INDIA" | "STATE_WISE" | null;
  sameLicenceForBothAudiences: boolean;
};

type Sub = {
  id: string;
  requirementId: string;
  audience: "CUSTOMER" | "DEALER" | "BOTH";
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
  expiryDate: Date;
  rejectionReason: string | null;
  revocationReason: string | null;
  customerStateIds: string[];
  dealerStateIds: string[];
};

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const ALL_STATES = ["MH", "GJ", "RJ", "KA"];

function buildIndex(
  requirements: Req[],
  submissions: Sub[],
  activeStateIds: string[] = ALL_STATES,
): SellerLicenceEligibilityIndex {
  const requirementsByNode = new Map<string, Req[]>();
  for (const r of requirements) {
    const key = `${r.taxonomyNodeType}:${r.taxonomyNodeId}`;
    requirementsByNode.set(key, [...(requirementsByNode.get(key) ?? []), r]);
  }
  const submissionsByRequirement = new Map<string, Sub[]>();
  for (const s of submissions) {
    submissionsByRequirement.set(s.requirementId, [
      ...(submissionsByRequirement.get(s.requirementId) ?? []),
      s,
    ]);
  }
  return {
    sellerId: "test-seller",
    requirementsByNode,
    submissionsByRequirement,
    activeStateIds,
  } as unknown as SellerLicenceEligibilityIndex;
}

function approvedSub(
  requirementId: string,
  audience: Sub["audience"],
  overrides: Partial<Sub> = {},
): Sub {
  return {
    id: `${requirementId}:${audience}:sub`,
    requirementId,
    audience,
    status: "APPROVED",
    expiryDate: FUTURE,
    rejectionReason: null,
    revocationReason: null,
    customerStateIds: [],
    dealerStateIds: [],
    ...overrides,
  };
}

function panIndiaReq(
  id: string,
  nodeType: Req["taxonomyNodeType"],
  nodeId: string,
  overrides: Partial<Req> = {},
): Req {
  return {
    id,
    taxonomyNodeType: nodeType,
    taxonomyNodeId: nodeId,
    name: id,
    customerRequired: true,
    customerGeoType: "PAN_INDIA",
    dealerRequired: false,
    dealerGeoType: null,
    sameLicenceForBothAudiences: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Hierarchy / inheritance
// ---------------------------------------------------------------------------

test("category requirement is inherited by subcategory and sub-subcategory", () => {
  const req = panIndiaReq("catReq", "CATEGORY", "cat1");
  const index = buildIndex([req], [approvedSub("catReq", "CUSTOMER")]);

  const atSubSub = evaluateEligibilityForPath(index, {
    categoryId: "cat1",
    subCategoryId: "sub1",
    subSubCategoryId: "subsub1",
  });
  assert.equal(atSubSub.requirements.length, 1);
  assert.equal(atSubSub.requirements[0]!.source, "CATEGORY");
  assert.equal(atSubSub.customer.isPanIndia, true);
});

test("subcategory requirement applies to sub-subcategories beneath it", () => {
  const req = panIndiaReq("subReq", "SUBCATEGORY", "sub1");
  const index = buildIndex([req], [approvedSub("subReq", "CUSTOMER")]);
  const result = evaluateEligibilityForPath(index, {
    categoryId: "cat1",
    subCategoryId: "sub1",
    subSubCategoryId: "subsub1",
  });
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0]!.source, "SUBCATEGORY");
});

test("a sub-subcategory requirement does not apply upward to its parent subcategory", () => {
  const req = panIndiaReq("leafReq", "SUBSUBCATEGORY", "subsub1");
  const index = buildIndex([req], [approvedSub("leafReq", "CUSTOMER")]);
  const atSubcategoryOnly = evaluateEligibilityForPath(index, {
    categoryId: "cat1",
    subCategoryId: "sub1",
    subSubCategoryId: null,
  });
  assert.equal(atSubcategoryOnly.requirements.length, 0);
});

test("a sibling category's requirement never leaks into another category", () => {
  const req = panIndiaReq("catAReq", "CATEGORY", "catA");
  const index = buildIndex([req], [approvedSub("catAReq", "CUSTOMER")]);
  const catB = evaluateEligibilityForPath(index, { categoryId: "catB" });
  assert.equal(catB.requirements.length, 0);
  assert.equal(catB.customer.isPanIndia, true);
  assert.equal(catB.customer.blockingRequirements.length, 0);
});

test("multiple inherited and direct requirements are all mandatory (AND logic)", () => {
  const reqs = [
    panIndiaReq("A", "CATEGORY", "cat1"),
    panIndiaReq("B", "CATEGORY", "cat1"),
    panIndiaReq("C", "SUBCATEGORY", "sub1"),
    panIndiaReq("D", "SUBSUBCATEGORY", "subsub1"),
  ];
  // A and C approved, B and D missing.
  const index = buildIndex(reqs, [approvedSub("A", "CUSTOMER"), approvedSub("C", "CUSTOMER")]);
  const result = evaluateEligibilityForPath(index, {
    categoryId: "cat1",
    subCategoryId: "sub1",
    subSubCategoryId: "subsub1",
  });
  assert.equal(result.requirements.length, 4);
  assert.equal(result.customer.eligibleStateIds.length, 0, "blocked because B and D are missing");
  assert.deepEqual(result.customer.blockingRequirements.map((b) => b.requirementId).sort(), [
    "B",
    "D",
  ]);
});

test("the same requirement id is evaluated once even if reachable through multiple node buckets", () => {
  // Contrived: same id present under both CATEGORY and SUBCATEGORY buckets
  // (can't happen from real data, but the dedup logic must still hold).
  const req = panIndiaReq("dup", "CATEGORY", "cat1");
  const reqAtSub = { ...req, taxonomyNodeType: "SUBCATEGORY" as const, taxonomyNodeId: "sub1" };
  const index = buildIndex([req, reqAtSub], [approvedSub("dup", "CUSTOMER")]);
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1", subCategoryId: "sub1" });
  assert.equal(result.requirements.length, 1);
});

// ---------------------------------------------------------------------------
// Audience and geography
// ---------------------------------------------------------------------------

test("customer Pan India + dealer state-wise are evaluated independently", () => {
  const req: Req = {
    id: "R",
    taxonomyNodeType: "CATEGORY",
    taxonomyNodeId: "cat1",
    name: "R",
    customerRequired: true,
    customerGeoType: "PAN_INDIA",
    dealerRequired: true,
    dealerGeoType: "STATE_WISE",
    sameLicenceForBothAudiences: false,
  };
  const index = buildIndex(
    [req],
    [approvedSub("R", "CUSTOMER"), approvedSub("R", "DEALER", { dealerStateIds: ["MH"] })],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.equal(result.customer.isPanIndia, true);
  assert.deepEqual(result.dealer.eligibleStateIds, ["MH"]);
});

test("dealer Pan India + customer state-wise, different states, does not require matching lists", () => {
  const req: Req = {
    id: "R",
    taxonomyNodeType: "CATEGORY",
    taxonomyNodeId: "cat1",
    name: "R",
    customerRequired: true,
    customerGeoType: "STATE_WISE",
    dealerRequired: true,
    dealerGeoType: "PAN_INDIA",
    sameLicenceForBothAudiences: false,
  };
  const index = buildIndex(
    [req],
    [approvedSub("R", "CUSTOMER", { customerStateIds: ["GJ", "RJ"] }), approvedSub("R", "DEALER")],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.deepEqual(result.customer.eligibleStateIds.sort(), ["GJ", "RJ"]);
  assert.equal(result.dealer.isPanIndia, true);
});

test("both audiences state-wise with genuinely different state lists", () => {
  const req: Req = {
    id: "R",
    taxonomyNodeType: "CATEGORY",
    taxonomyNodeId: "cat1",
    name: "R",
    customerRequired: true,
    customerGeoType: "STATE_WISE",
    dealerRequired: true,
    dealerGeoType: "STATE_WISE",
    sameLicenceForBothAudiences: false,
  };
  const index = buildIndex(
    [req],
    [
      approvedSub("R", "CUSTOMER", { customerStateIds: ["MH"] }),
      approvedSub("R", "DEALER", { dealerStateIds: ["KA", "RJ"] }),
    ],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.deepEqual(result.customer.eligibleStateIds, ["MH"]);
  assert.deepEqual(result.dealer.eligibleStateIds.sort(), ["KA", "RJ"]);
});

test("a common licence for both audiences covers both from one BOTH submission", () => {
  const req: Req = {
    id: "R",
    taxonomyNodeType: "CATEGORY",
    taxonomyNodeId: "cat1",
    name: "R",
    customerRequired: true,
    customerGeoType: "PAN_INDIA",
    dealerRequired: true,
    dealerGeoType: "STATE_WISE",
    sameLicenceForBothAudiences: true,
  };
  const index = buildIndex([req], [approvedSub("R", "BOTH", { dealerStateIds: ["MH"] })]);
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.equal(result.customer.isPanIndia, true);
  assert.deepEqual(result.dealer.eligibleStateIds, ["MH"]);
});

test("separate licences for both audiences: one missing still blocks only that audience", () => {
  const req: Req = {
    id: "R",
    taxonomyNodeType: "CATEGORY",
    taxonomyNodeId: "cat1",
    name: "R",
    customerRequired: true,
    customerGeoType: "PAN_INDIA",
    dealerRequired: true,
    dealerGeoType: "PAN_INDIA",
    sameLicenceForBothAudiences: false,
  };
  const index = buildIndex([req], [approvedSub("R", "CUSTOMER")]); // no DEALER submission at all
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.equal(result.customer.isPanIndia, true);
  assert.equal(result.dealer.eligibleStateIds.length, 0);
  assert.equal(result.dealer.blockingRequirements[0]!.status, "MISSING");
});

test("a customer-only requirement never blocks dealer eligibility", () => {
  const req = panIndiaReq("custOnly", "CATEGORY", "cat1", {
    customerRequired: true,
    dealerRequired: false,
  });
  const index = buildIndex([req], []); // no submission at all — customer is blocked, dealer must be unaffected
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.equal(result.customer.eligibleStateIds.length, 0);
  assert.equal(result.dealer.isPanIndia, true);
  assert.equal(result.dealer.blockingRequirements.length, 0);
});

test("a dealer-only requirement never blocks customer eligibility", () => {
  const req: Req = {
    id: "R",
    taxonomyNodeType: "CATEGORY",
    taxonomyNodeId: "cat1",
    name: "R",
    customerRequired: false,
    customerGeoType: null,
    dealerRequired: true,
    dealerGeoType: "PAN_INDIA",
    sameLicenceForBothAudiences: false,
  };
  const index = buildIndex([req], []);
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.equal(result.dealer.eligibleStateIds.length, 0);
  assert.equal(result.customer.isPanIndia, true);
});

test("Pan India approval satisfies every currently-active state for that audience", () => {
  const req = panIndiaReq("R", "CATEGORY", "cat1");
  const index = buildIndex([req], [approvedSub("R", "CUSTOMER")], ["MH", "GJ", "RJ", "KA", "TN"]);
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.deepEqual(result.customer.eligibleStateIds.sort(), ["GJ", "KA", "MH", "RJ", "TN"]);
});

test("state-wise approval satisfies only the selected states", () => {
  const req: Req = { ...panIndiaReq("R", "CATEGORY", "cat1"), customerGeoType: "STATE_WISE" };
  const index = buildIndex(
    [req],
    [approvedSub("R", "CUSTOMER", { customerStateIds: ["MH", "GJ"] })],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.deepEqual(result.customer.eligibleStateIds.sort(), ["GJ", "MH"]);
});

test("multiple concurrent approved submissions for the same state-wise requirement are unioned, not just the first one", () => {
  // Mirrors real submission data: STATE_WISE forces exactly one state per
  // submission row, so a seller approved for several states has several
  // separate current SellerLicenceSubmission rows for the same
  // requirement+audience, not one row with several states.
  const req: Req = { ...panIndiaReq("R", "CATEGORY", "cat1"), dealerRequired: true, dealerGeoType: "STATE_WISE", customerRequired: false, customerGeoType: null };
  const index = buildIndex(
    [req],
    [
      { ...approvedSub("R", "DEALER"), id: "sub-mh", dealerStateIds: ["MH"] },
      { ...approvedSub("R", "DEALER"), id: "sub-gj", dealerStateIds: ["GJ"] },
      { ...approvedSub("R", "DEALER"), id: "sub-ka", dealerStateIds: ["KA"] },
    ],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.deepEqual(result.dealer.eligibleStateIds.sort(), ["GJ", "KA", "MH"]);
  assert.equal(result.dealer.blockingRequirements.length, 0);
});

test("a pending submission for one state doesn't block coverage already approved for other states", () => {
  const req: Req = { ...panIndiaReq("R", "CATEGORY", "cat1"), dealerRequired: true, dealerGeoType: "STATE_WISE", customerRequired: false, customerGeoType: null };
  const index = buildIndex(
    [req],
    [
      { ...approvedSub("R", "DEALER"), id: "sub-mh", dealerStateIds: ["MH"] },
      { ...approvedSub("R", "DEALER"), id: "sub-gj", status: "PENDING_APPROVAL", dealerStateIds: ["GJ"] },
    ],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.deepEqual(result.dealer.eligibleStateIds, ["MH"]);
});

test("multiple state-wise requirements produce the intersection of eligible states", () => {
  const reqA: Req = { ...panIndiaReq("A", "CATEGORY", "cat1"), customerGeoType: "STATE_WISE" };
  const reqB: Req = { ...panIndiaReq("B", "SUBCATEGORY", "sub1"), customerGeoType: "STATE_WISE" };
  const index = buildIndex(
    [reqA, reqB],
    [
      approvedSub("A", "CUSTOMER", { customerStateIds: ["MH", "GJ", "RJ"] }),
      approvedSub("B", "CUSTOMER", { customerStateIds: ["GJ", "KA"] }),
    ],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1", subCategoryId: "sub1" });
  assert.deepEqual(result.customer.eligibleStateIds, ["GJ"]);
});

// ---------------------------------------------------------------------------
// Status validity
// ---------------------------------------------------------------------------

for (const status of ["PENDING_APPROVAL", "REJECTED", "EXPIRED", "REVOKED"] as const) {
  test(`a ${status} submission does not count as valid`, () => {
    const req = panIndiaReq("R", "CATEGORY", "cat1");
    const index = buildIndex([req], [approvedSub("R", "CUSTOMER", { status })]);
    const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
    assert.equal(result.customer.eligibleStateIds.length, 0);
    assert.equal(result.customer.blockingRequirements[0]!.status, status);
  });
}

test("an approved, unexpired submission counts as valid", () => {
  const req = panIndiaReq("R", "CATEGORY", "cat1");
  const index = buildIndex([req], [approvedSub("R", "CUSTOMER")]);
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  assert.equal(result.customer.isPanIndia, true);
  assert.equal(result.customer.blockingRequirements.length, 0);
});

// ---------------------------------------------------------------------------
// explainBlockedState
// ---------------------------------------------------------------------------

test("explainBlockedState lists every missing/invalid requirement blocking a state", () => {
  const reqA = panIndiaReq("A", "CATEGORY", "cat1", { name: "Licence A" });
  const reqB = panIndiaReq("B", "SUBCATEGORY", "sub1", { name: "Licence B" });
  const index = buildIndex(
    [reqA, reqB],
    [approvedSub("A", "CUSTOMER", { status: "PENDING_APPROVAL" })],
  );
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1", subCategoryId: "sub1" });
  const reasons = explainBlockedState(result, "customer", "MH");
  assert.equal(reasons.length, 2);
  assert.ok(reasons.some((r) => r.includes("Licence A")));
  assert.ok(reasons.some((r) => r.includes("Licence B")));
});

test("explainBlockedState explains a satisfied-but-narrower state-wise requirement", () => {
  const req: Req = {
    ...panIndiaReq("R", "CATEGORY", "cat1", { name: "State Licence" }),
    customerGeoType: "STATE_WISE",
  };
  const index = buildIndex([req], [approvedSub("R", "CUSTOMER", { customerStateIds: ["MH"] })]);
  const result = evaluateEligibilityForPath(index, { categoryId: "cat1" });
  const reasons = explainBlockedState(result, "customer", "GJ");
  assert.equal(reasons.length, 1);
  assert.ok(reasons[0]!.includes("State Licence"));
});
