export type GalleryImage = { id: string; url: string; altText: string | null };

/**
 * Variant images take priority over the general product gallery — a
 * variant with no images of its own falls back to the product's entirely
 * (never a mix of "some variant images, some product images" unless the
 * variant genuinely has none). Dedupes by URL so an image that happens to
 * also appear in the product's general gallery isn't shown twice. Pulled
 * out of ProductGallery (a client component) so this merge rule is
 * testable without a DOM/React test runner, which this codebase doesn't
 * have set up.
 */
export function mergeVariantGallery(
  variantImages: GalleryImage[] | null | undefined,
  productImages: GalleryImage[],
): GalleryImage[] {
  if (variantImages && variantImages.length > 0) {
    return [
      ...variantImages,
      ...productImages.filter((img) => !variantImages.some((v) => v.url === img.url)),
    ];
  }
  return productImages;
}

/** Same fallback rule as images — the variant's own video wins if it has one, else the product's. */
export function resolveVideoUrl(
  variantVideo: string | null | undefined,
  productVideo: string | null | undefined,
): string | null {
  return variantVideo || productVideo || null;
}
