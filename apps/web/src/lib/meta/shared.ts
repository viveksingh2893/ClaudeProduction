/**
 * Meta Pixel + Conversions API — pieces shared by the browser side
 * (components/meta/meta-tracking.tsx, lib/meta/track.ts) and the server
 * relay (app/api/meta/event/route.ts). Nothing here is domain-specific: the
 * pixel is switched on purely by NEXT_PUBLIC_META_PIXEL_ID, so moving the
 * site from katra4u.com to kisan4u.com needs no code change.
 */

/** "granted" | "denied" — set by the cookie consent banner. No cookie = not asked yet = no tracking. */
export const META_CONSENT_COOKIE = "k4u_cookie_consent";
export type MetaConsent = "granted" | "denied";
/** One year, in seconds. */
export const META_CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

/** The standard events the storefront may send — the server relay rejects anything else. */
export const META_EVENT_NAMES = [
  "PageView",
  "ViewContent",
  "Search",
  "AddToCart",
  "AddToWishlist",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Purchase",
  "CompleteRegistration",
  "Lead",
  "Contact",
] as const;
export type MetaEventName = (typeof META_EVENT_NAMES)[number];

/**
 * Meta's custom_data. Product ids are always the variant SKU (the key the
 * legacy catalogue migrated with) and currency is always INR.
 */
export type MetaCustomData = {
  value?: number;
  currency?: "INR";
  content_ids?: string[];
  content_type?: "product";
  contents?: { id: string; quantity: number; item_price?: number }[];
  content_name?: string;
  num_items?: number;
  search_string?: string;
  order_id?: string;
};

/** A cart / order summarised for the checkout events (InitiateCheckout, AddPaymentInfo, Purchase). */
export type MetaCartSummary = {
  contents: { id: string; quantity: number; item_price: number }[];
  value: number;
};

export function metaCustomDataForCart(cart: MetaCartSummary): MetaCustomData {
  return {
    content_ids: cart.contents.map((c) => c.id),
    content_type: "product",
    contents: cart.contents,
    num_items: cart.contents.reduce((n, c) => n + c.quantity, 0),
    value: cart.value,
  };
}

/** Hashed (SHA-256) advanced-matching fields for the signed-in buyer — see lib/meta/user-data.ts. */
export type MetaUserMatch = { ph?: string; em?: string; external_id?: string };

/**
 * Local / dev / tailnet hosts never send anything, even with the pixel id
 * set (the Pi's dev and live builds share one .env).
 */
export function isTrackableHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".ts.net")) return false;
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return true;
}
