/**
 * True for the customer product page (/products/<slug>) and its dealer
 * twin (/dealer/products/<id>) — never for the listing pages themselves
 * (/products, /dealer/products with nothing after). Both pages drop the
 * category ribbon and the mobile bottom nav for a focused, Flipkart-style
 * layout with their own fixed StickyBuyBar instead — see category-nav.tsx,
 * bottom-nav.tsx and pdp-footer-spacer.tsx, the three places this needs to
 * agree.
 */
export function isProductDetailPath(pathname: string): boolean {
  return /^\/products\/[^/]+$/.test(pathname) || /^\/dealer\/products\/[^/]+$/.test(pathname);
}
