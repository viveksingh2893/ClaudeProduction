"use client";

import {
  META_CONSENT_COOKIE,
  isTrackableHost,
  metaCustomDataForCart,
  type MetaCartSummary,
  type MetaCustomData,
  type MetaEventName,
} from "./shared";

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export function hasTrackingConsent(): boolean {
  return document.cookie.split("; ").some((c) => c === `${META_CONSENT_COOKIE}=granted`);
}

/** Meta's standard base code, as a function — only ever called after consent (components/meta/meta-tracking.tsx). */
export function loadMetaPixelScript(): void {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
}

let pixelStarted = false;
const pending: [MetaEventName, MetaCustomData | undefined, string | undefined][] = [];

/** Called by MetaTracking right after fbq("init") — sends anything queued meanwhile. */
export function markMetaPixelStarted(): void {
  pixelStarted = true;
  for (const [name, data, id] of pending.splice(0)) trackMetaEvent(name, data, id);
}

function newEventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Sends one standard event to Meta twice — from the browser (pixel) and via
 * the server (/api/meta/event → Conversions API) — with a shared event id so
 * Meta de-duplicates them. A no-op until the visitor accepts cookies, on
 * local/dev hosts, or when the pixel isn't configured. Product ids are the
 * variant SKU; values are in INR.
 */
export function trackMetaEvent(
  eventName: MetaEventName,
  customData?: MetaCustomData,
  /** A fixed id (e.g. per order for Purchase) so a repeat can never count twice; random otherwise. */
  fixedEventId?: string,
): void {
  if (typeof window === "undefined" || !hasTrackingConsent()) return;
  // A page's own effects run before the layout's MetaTracking starts the
  // pixel on a fresh load — hold those events until it does. (Only ever
  // after consent: nothing from before Accept is kept for later.)
  if (!pixelStarted) {
    if (pending.length < 20) pending.push([eventName, customData, fixedEventId]);
    return;
  }
  if (!window.fbq || !isTrackableHost(window.location.hostname)) return;

  const data = customData?.value !== undefined ? { ...customData, currency: "INR" as const } : customData;
  const eventId = fixedEventId ?? newEventId();
  window.fbq("track", eventName, data ?? {}, { eventID: eventId });

  const payload = JSON.stringify({
    eventName,
    eventId,
    eventSourceUrl: window.location.href,
    customData: data,
  });
  fetch("/api/meta/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

/** What the cart / wishlist server actions hand back for tracking (lib/meta/product-data.ts). */
type ProductInfo = { sku: string; price: number; name: string } | null | undefined;

export function trackAddToCart(product: ProductInfo, quantity: number): void {
  if (!product) return;
  trackMetaEvent("AddToCart", {
    content_ids: [product.sku],
    content_type: "product",
    content_name: product.name,
    contents: [{ id: product.sku, quantity, item_price: product.price }],
    value: Math.round(product.price * quantity * 100) / 100,
  });
}

export function trackInitiateCheckout(cart: MetaCartSummary): void {
  trackMetaEvent("InitiateCheckout", metaCustomDataForCart(cart));
}

/** When the buyer submits their payment choice ("Place order"). */
export function trackAddPaymentInfo(cart: MetaCartSummary): void {
  trackMetaEvent("AddPaymentInfo", metaCustomDataForCart(cart));
}

/** Order placed (COD) / paid (online). The event id is fixed per checkout, so a reload of the confirmation page never double-counts. */
export function trackPurchase(checkoutGroupId: string, orderNumber: string, cart: MetaCartSummary): void {
  trackMetaEvent(
    "Purchase",
    { ...metaCustomDataForCart(cart), order_id: orderNumber },
    `purchase-${checkoutGroupId}`,
  );
}

export function trackAddToWishlist(product: ProductInfo): void {
  if (!product) return;
  trackMetaEvent("AddToWishlist", {
    content_ids: [product.sku],
    content_type: "product",
    content_name: product.name,
    value: product.price,
  });
}
