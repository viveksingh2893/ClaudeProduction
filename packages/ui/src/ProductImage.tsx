"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/**
 * The one shared product-image primitive — every product thumbnail/gallery
 * image on the storefront (cards, search/category/homepage grids, product
 * detail gallery + thumbnails, cart/wishlist rows, order line items) goes
 * through this instead of a bare <img>, so sizing/fit/fallback behaviour
 * can't drift between call sites. Always `object-contain` on a neutral
 * background (never `cover`) — the full product must stay visible, never
 * cropped. The caller owns the frame's size/shape (aspect ratio, rounding,
 * background tint) via `className`/the wrapping element; this only owns
 * the image itself plus the broken/missing fallback.
 *
 * No next/image here — deliberately: this repo has no image optimizer or
 * storage-domain loader configured anywhere yet (see the repeated
 * `no-img-element` eslint-disable comments this replaces), so a plain
 * <img> is consistent with the rest of the codebase rather than a
 * one-off exception.
 */
export function ProductImage({
  src,
  alt,
  loading = "lazy",
  fallbackLabel,
}: {
  src: string | null | undefined;
  alt: string;
  loading?: "eager" | "lazy";
  fallbackLabel?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-gray-400">
        <ImageOff className="h-5 w-5" aria-hidden="true" />
        {fallbackLabel && (
          <span className="line-clamp-2 text-[11px] font-medium leading-snug">{fallbackLabel}</span>
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- no image optimizer/storage-domain loader configured yet; this is the single, deliberate call site every other product image goes through
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-contain"
      loading={loading}
      onError={() => setBroken(true)}
    />
  );
}
