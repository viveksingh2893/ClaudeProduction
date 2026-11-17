"use client";

import { usePathname } from "next/navigation";
import { isProductDetailPath } from "@/lib/is-pdp-route";

/**
 * The product detail page (customer or dealer) pins a fixed Add to Cart /
 * Buy Now bar to the bottom of the viewport. Without extra scroll space
 * below the footer that bar would cover the footer's bottom edge when
 * scrolled all the way down. This renders that space — only there.
 */
export function PdpFooterSpacer() {
  const pathname = usePathname();
  if (!isProductDetailPath(pathname)) return null;
  return <div aria-hidden="true" className="h-20 md:h-16" />;
}
