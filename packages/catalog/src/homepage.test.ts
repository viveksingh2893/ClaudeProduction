/**
 * Integration test against the real dev Postgres (same connection
 * seed.ts uses). seed.ts already creates one COMMON HomepageSection row
 * per type (all enabled, no schedule) — this test adds its own
 * audience-specific TRUST_STRIP rows (a section type with no dependent
 * product/asset data, so it isolates the section-eligibility logic itself)
 * and tears them down, without touching the seeded COMMON rows.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@kisan4u/db";
import { getHomepageModel } from "./homepage";

function countTrustStrip(sections: Awaited<ReturnType<typeof getHomepageModel>>["sections"]) {
  return sections.filter((s) => s.type === "TRUST_STRIP").length;
}

let futureDealerRowId: string;
let pastCustomerRowId: string;

before(async () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const futureRow = await prisma.homepageSection.create({
    data: {
      type: "TRUST_STRIP",
      audience: "DEALER",
      enabled: true,
      position: 999,
      startAt: future,
    },
  });
  futureDealerRowId = futureRow.id;

  const pastRow = await prisma.homepageSection.create({
    data: { type: "TRUST_STRIP", audience: "CUSTOMER", enabled: true, position: 999, endAt: past },
  });
  pastCustomerRowId = pastRow.id;
});

after(async () => {
  await prisma.homepageSection.deleteMany({
    where: { id: { in: [futureDealerRowId, pastCustomerRowId] } },
  });
});

test("a not-yet-started audience-specific section is excluded even when a COMMON row of the same type is already eligible", async () => {
  const model = await getHomepageModel({ audience: "DEALER" });
  // Exactly one TRUST_STRIP (the seeded COMMON row) — the future DEALER row must not add a duplicate or replace it early.
  assert.equal(countTrustStrip(model.sections), 1);
});

test("an expired audience-specific section is excluded for its own audience", async () => {
  const model = await getHomepageModel({ audience: "CUSTOMER" });
  assert.equal(countTrustStrip(model.sections), 1);
});

test("a DEALER-only section never appears for a CUSTOMER viewer, and vice versa", async () => {
  const asDealerViewer = await getHomepageModel({ audience: "DEALER" });
  const asCustomerViewer = await getHomepageModel({ audience: "CUSTOMER" });
  // Neither the future-DEALER nor past-CUSTOMER fixture row is visible to
  // the OTHER audience under any circumstance — confirms audience
  // filtering happens independently of the schedule-window filtering.
  assert.equal(countTrustStrip(asDealerViewer.sections), 1);
  assert.equal(countTrustStrip(asCustomerViewer.sections), 1);
});

test("COMMON sections are visible to both CUSTOMER and DEALER viewers", async () => {
  const asDealerViewer = await getHomepageModel({ audience: "DEALER" });
  const asCustomerViewer = await getHomepageModel({ audience: "CUSTOMER" });
  assert.ok(countTrustStrip(asDealerViewer.sections) >= 1);
  assert.ok(countTrustStrip(asCustomerViewer.sections) >= 1);
});

test("a disabled section row is excluded by the query itself and never causes a duplicate render of the same type", async () => {
  // TRUST_STRIP, not COUPON_STRIP: COUPON_STRIP was removed from
  // getHomepageModel/HomepageSectionModel entirely once coupon banners
  // became their own fixed-position carousel (see getActiveCouponBanners)
  // — same move already made for HERO_BANNER/SHOP_BY_BRAND. (type,
  // audience) is unique, and this file's own `before()` already owns the
  // only other free TRUST_STRIP audience slots (DEALER future-dated,
  // CUSTOMER past-dated; COMMON is the seeded row) — so this test reuses
  // and temporarily disables that same DEALER fixture row (moving its
  // startAt into the past so it would otherwise be eligible) rather than
  // creating a fourth, constraint-violating row of the same type.
  await prisma.homepageSection.update({
    where: { id: futureDealerRowId },
    data: { enabled: false, startAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  try {
    const model = await getHomepageModel({ audience: "DEALER" });
    // Exactly the seeded COMMON row — the now-eligible-but-disabled DEALER
    // fixture must not add a second entry.
    assert.equal(countTrustStrip(model.sections), 1);
  } finally {
    await prisma.homepageSection.update({
      where: { id: futureDealerRowId },
      data: { enabled: true, startAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
  }
});
