"use client";

import { useEffect, useRef, useState } from "react";
import { Carousel, ProductImage } from "@kisan4u/ui";
import { mergeVariantGallery, resolveVideoUrl, type GalleryImage } from "@/lib/gallery-fallback";
import { VideoEmbed } from "./video-embed";
import { ProductImageLightbox, ZoomHintButton } from "./product-image-lightbox";

export type { GalleryImage };

/**
 * Reuses the shared Carousel primitive (packages/ui/src/Carousel.tsx —
 * already ships touch-swipe, arrow keys, and Previous/Next controls,
 * built for the homepage banner and product-card carousels) for the main
 * image instead of a second bespoke swipe implementation, plus a
 * thumbnail strip for quick jumping on larger screens.
 *
 * `variantImages` is prepended ahead of the product's general images when
 * non-empty (variant images take priority, falling back to the general
 * gallery entirely when the variant has none of its own) and only resets
 * the active slide back to the start when the resolved variant actually
 * changes (compared by its first image's URL), never on an unrelated
 * re-render, so browsing the gallery isn't interrupted by something else
 * on the page updating. `video`/`fallbackVideo` follows the exact same
 * priority: the variant's own video if it has one, else the product's.
 */
export function ProductGallery({
  images,
  name,
  variantImages,
  video,
  fallbackVideo,
}: {
  images: GalleryImage[];
  name: string;
  variantImages?: GalleryImage[] | null;
  /** The resolved variant's own video, if it has one. */
  video?: string | null;
  /** The product's own video, used when the variant has none. */
  fallbackVideo?: string | null;
}) {
  const hasVariantImages = !!variantImages && variantImages.length > 0;
  const gallery = mergeVariantGallery(variantImages, images);
  const effectiveVideo = resolveVideoUrl(video, fallbackVideo);

  const [active, setActive] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const variantKey = hasVariantImages ? variantImages!.map((v) => v.url).join("|") : "";
  const lastVariantKey = useRef(variantKey);
  useEffect(() => {
    if (variantKey !== lastVariantKey.current) {
      lastVariantKey.current = variantKey;
      setActive(0);
    }
  }, [variantKey]);

  const clampedActive = Math.min(active, Math.max(0, gallery.length - 1));
  if (gallery.length === 0 && !effectiveVideo) return null;

  return (
    <div className="flex flex-col gap-2.5">
      {gallery.length > 0 && (
        <>
          <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-green-50">
            <Carousel
              ariaLabel={`${name} images`}
              showArrows={gallery.length > 1}
              showDots={gallery.length > 1}
              activeIndex={clampedActive}
              onActiveIndexChange={setActive}
              slides={gallery.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setZoomOpen(true)}
                  aria-label="Zoom image"
                  className="block h-full w-full cursor-zoom-in"
                >
                  <ProductImage
                    src={img.url}
                    alt={img.altText ?? name}
                    loading={i === 0 ? "eager" : "lazy"}
                  />
                </button>
              ))}
            />
            <ZoomHintButton onClick={() => setZoomOpen(true)} />
          </div>
          {gallery.length > 1 && (
            <div className="hidden grid-cols-4 gap-2 sm:grid">
              {gallery.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Show image ${i + 1} of ${gallery.length}`}
                  aria-current={i === clampedActive}
                  className={`aspect-square overflow-hidden rounded-lg border-2 bg-green-50 ${i === clampedActive ? "border-green-600" : "border-border"}`}
                >
                  <ProductImage src={img.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {effectiveVideo && <VideoEmbed url={effectiveVideo} title={`${name} video`} />}

      {zoomOpen && gallery.length > 0 && (
        <ProductImageLightbox
          images={gallery.map((img) => ({ id: img.id, url: img.url, altText: img.altText ?? name }))}
          index={clampedActive}
          onIndexChange={setActive}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </div>
  );
}
