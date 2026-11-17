"use client";

import { useState, useTransition } from "react";
import { toggleWishlistAction } from "@/app/wishlist/actions";
import { trackAddToWishlist } from "@/lib/meta/track";

/**
 * Product Card Design Spec §Shared card structure: "Icon button at image
 * corner; does not trigger card navigation." Both `preventDefault` (the
 * card image sits inside a <Link>) and `stopPropagation` are required —
 * this button is nested inside the anchor, not a sibling of it.
 */
export function WishlistButton({
  productId,
  initialWishlisted,
  className = "",
}: {
  productId: string;
  initialWishlisted: boolean;
  className?: string;
}) {
  const [wishlisted, setWishlisted] = useState(initialWishlisted);
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      const result = await toggleWishlistAction(productId);
      if (!result.ok) return;
      setWishlisted(result.wishlisted);
      if (result.wishlisted) trackAddToWishlist(result.meta);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={wishlisted}
      aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-base shadow-card transition-transform hover:scale-105 hover:bg-white disabled:opacity-60 ${className}`}
    >
      <span aria-hidden="true" className={wishlisted ? "text-danger" : "text-gray-400"}>
        {wishlisted ? "♥" : "♡"}
      </span>
    </button>
  );
}
