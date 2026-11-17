/**
 * Pure link-list/active-state logic for the site-wide top navigation —
 * kept dependency-free (no Next.js/session imports) so it's unit-testable
 * directly with node:test (see nav-links.test.ts) without needing to
 * render a React tree. TopNav (a Client Component) and SiteHeader (the
 * Server Component that resolves the actual role/cart-count) both use
 * this as the single source of "what links does this account see."
 */
export type NavRole = "CUSTOMER" | "DEALER" | "GUEST";

export type NavLinkItem = { href: string; label: string };

const CUSTOMER_LINKS: NavLinkItem[] = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/cart", label: "Cart" },
  { href: "/orders", label: "Orders" },
  { href: "/account", label: "Account" },
];

const DEALER_LINKS: NavLinkItem[] = [
  { href: "/", label: "Home" },
  { href: "/dealer/products", label: "Products" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/cart", label: "Cart" },
  { href: "/orders", label: "Orders" },
  { href: "/dealer/requests", label: "Product Requests" },
  { href: "/account", label: "Account" },
];

// Cart is included for guests: a signed-out visitor can fill a cart and
// carry it into checkout (they verify a mobile number there). Orders and
// Account still require a real account.
const GUEST_LINKS: NavLinkItem[] = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/cart", label: "Cart" },
];

/**
 * Never returns an admin/seller-dashboard link, and never a
 * role-inappropriate one — a customer never sees "Product Requests" (a
 * dealer-only concept) and a dealer never sees the generic customer
 * catalogue link, only their own priced one.
 */
export function getNavLinks(role: NavRole): NavLinkItem[] {
  if (role === "DEALER") return DEALER_LINKS;
  if (role === "CUSTOMER") return CUSTOMER_LINKS;
  return GUEST_LINKS;
}

/** Home ("/") only matches exactly; every other link also matches its own sub-paths (e.g. "/orders/abc123" highlights "Orders"). */
export function isActiveNavLink(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
