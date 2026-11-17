import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeVariantGallery, resolveVideoUrl } from "./gallery-fallback";

const productImages = [
  { id: "p1", url: "https://cdn/p1.jpg", altText: "Product 1" },
  { id: "p2", url: "https://cdn/p2.jpg", altText: "Product 2" },
];

test("a variant with its own images shows them ahead of the product's general gallery", () => {
  const variantImages = [{ id: "v1", url: "https://cdn/v1.jpg", altText: "Variant 1" }];
  const result = mergeVariantGallery(variantImages, productImages);
  assert.deepEqual(
    result.map((i) => i.id),
    ["v1", "p1", "p2"],
  );
});

test("a variant with no images of its own falls back entirely to the product's gallery", () => {
  assert.deepEqual(mergeVariantGallery([], productImages), productImages);
  assert.deepEqual(mergeVariantGallery(null, productImages), productImages);
  assert.deepEqual(mergeVariantGallery(undefined, productImages), productImages);
});

test("an image shared between the variant and the product gallery is not duplicated", () => {
  const variantImages = [{ id: "v1", url: "https://cdn/p1.jpg", altText: "Same as product 1" }];
  const result = mergeVariantGallery(variantImages, productImages);
  assert.deepEqual(
    result.map((i) => i.id),
    ["v1", "p2"],
  );
});

test("resolveVideoUrl prefers the variant's own video over the product's", () => {
  assert.equal(resolveVideoUrl("https://variant-video", "https://product-video"), "https://variant-video");
});

test("resolveVideoUrl falls back to the product's video when the variant has none", () => {
  assert.equal(resolveVideoUrl(null, "https://product-video"), "https://product-video");
  assert.equal(resolveVideoUrl(undefined, "https://product-video"), "https://product-video");
  assert.equal(resolveVideoUrl("", "https://product-video"), "https://product-video");
});

test("resolveVideoUrl returns null when neither the variant nor the product has a video", () => {
  assert.equal(resolveVideoUrl(null, null), null);
  assert.equal(resolveVideoUrl(undefined, undefined), null);
});
