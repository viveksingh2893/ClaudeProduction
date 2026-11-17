/** Pure zod-schema tests, no DB — first *.test.ts file in this package. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  promotionalAssetInputSchema,
  dealOfTheDayInputSchema,
  homepageSectionInputSchema,
} from "./homepage";
import { mediaUrlSchema } from "./primitives";

test("promotionalAssetInputSchema rejects a javascript: link URL", () => {
  const result = promotionalAssetInputSchema.safeParse({
    placement: "HERO",
    desktopImageUrl: "/demo/hero.jpg",
    altText: "Hero banner",
    linkUrl: "javascript:alert(1)",
  });
  assert.equal(result.success, false);
});

test("promotionalAssetInputSchema rejects a data: link URL", () => {
  const result = promotionalAssetInputSchema.safeParse({
    placement: "HERO",
    desktopImageUrl: "/demo/hero.jpg",
    altText: "Hero banner",
    linkUrl: "data:text/html,<script>alert(1)</script>",
  });
  assert.equal(result.success, false);
});

test("promotionalAssetInputSchema accepts a relative internal link and an https:// external link", () => {
  const internal = promotionalAssetInputSchema.safeParse({
    placement: "HERO",
    desktopImageUrl: "/demo/hero.jpg",
    altText: "Hero banner",
    linkUrl: "/products",
  });
  assert.equal(internal.success, true);

  const external = promotionalAssetInputSchema.safeParse({
    placement: "HERO",
    desktopImageUrl: "/demo/hero.jpg",
    altText: "Hero banner",
    linkUrl: "https://kisan4u.com/offer",
  });
  assert.equal(external.success, true);
});

test("promotionalAssetInputSchema rejects startAt >= endAt", () => {
  const result = promotionalAssetInputSchema.safeParse({
    placement: "COUPON",
    desktopImageUrl: "/demo/coupon.jpg",
    altText: "Coupon strip",
    startAt: "2026-08-10T00:00:00.000Z",
    endAt: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("dealOfTheDayInputSchema rejects startAt >= endAt and non-positive prices", () => {
  const badSchedule = dealOfTheDayInputSchema.safeParse({
    productId: "p1",
    dealPrice: 100,
    startAt: "2026-08-10T00:00:00.000Z",
    endAt: "2026-08-05T00:00:00.000Z",
  });
  assert.equal(badSchedule.success, false);

  const badPrice = dealOfTheDayInputSchema.safeParse({
    productId: "p1",
    dealPrice: 0,
    startAt: "2026-08-01T00:00:00.000Z",
    endAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(badPrice.success, false);
});

test("homepageSectionInputSchema rejects startAt >= endAt", () => {
  const result = homepageSectionInputSchema.safeParse({
    id: "s1",
    startAt: "2026-08-10T00:00:00.000Z",
    endAt: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("mediaUrlSchema (reused for footer/link validation) rejects javascript: and accepts a relative path", () => {
  assert.equal(mediaUrlSchema.safeParse("javascript:alert(1)").success, false);
  assert.equal(mediaUrlSchema.safeParse("/policies/terms").success, true);
});
