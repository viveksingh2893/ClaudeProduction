/**
 * Pure-function unit tests, no DB needed — orderedImageUrls
 * (product-card-adapter.ts), the fix for "the primary image doesn't show
 * on the product card." Before this, a card's imageUrls came from the
 * gallery ALONE whenever the gallery was non-empty, completely ignoring
 * primaryImageUrl — a seller who set a primary image separately from the
 * carousel (a normal, unremarkable thing to do) never saw it on the card
 * at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderedImageUrls } from "./product-card-adapter";

test("the primary image leads even when the gallery is non-empty and doesn't include it", () => {
  const result = orderedImageUrls("primary.jpg", ["gallery-1.jpg", "gallery-2.jpg"]);
  assert.deepEqual(result, ["primary.jpg", "gallery-1.jpg", "gallery-2.jpg"]);
});

test("a primary image that's also in the gallery is not duplicated", () => {
  const result = orderedImageUrls("shared.jpg", ["shared.jpg", "gallery-2.jpg"]);
  assert.deepEqual(result, ["shared.jpg", "gallery-2.jpg"]);
});

test("an empty gallery falls back to just the primary image", () => {
  assert.deepEqual(orderedImageUrls("primary.jpg", []), ["primary.jpg"]);
});

test("no primary image falls back to the gallery alone", () => {
  assert.deepEqual(orderedImageUrls("", ["gallery-1.jpg", "gallery-2.jpg"]), [
    "gallery-1.jpg",
    "gallery-2.jpg",
  ]);
});
