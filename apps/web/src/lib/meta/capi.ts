import "server-only";
import type { MetaCustomData, MetaEventName, MetaUserMatch } from "./shared";

/**
 * Meta Conversions API — the server-side copy of a pixel event. Browsers
 * that block the pixel still get counted, and because both copies carry the
 * same event_id Meta counts the event once.
 *
 * Env (apps/web/.env, "Meta Pixel + Conversions API" section):
 *   NEXT_PUBLIC_META_PIXEL_ID  — the pixel (dataset) id; unset = off.
 *   META_CAPI_ACCESS_TOKEN     — secret; unset = server copies skipped.
 *   META_TEST_EVENT_CODE       — optional; while set, events show up under
 *                                Events Manager → Test events. Remove once
 *                                verified.
 *   META_GRAPH_API_VERSION     — optional, defaults below.
 */
const DEFAULT_GRAPH_API_VERSION = "v22.0";

export type MetaServerEvent = {
  eventName: MetaEventName;
  eventId: string;
  eventSourceUrl: string;
  userMatch: MetaUserMatch;
  clientIp?: string;
  userAgent?: string;
  /** The pixel's _fbp / _fbc cookies, when present. */
  fbp?: string;
  fbc?: string;
  customData?: MetaCustomData;
};

export function isMetaCapiConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_META_PIXEL_ID && !!process.env.META_CAPI_ACCESS_TOKEN;
}

/** Never throws — tracking must not break a page or checkout. Returns whether Meta accepted it. */
export async function sendMetaCapiEvent(event: MetaServerEvent): Promise<boolean> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return false;

  const version = process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
  const { ph, em, external_id } = event.userMatch;
  const body = {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        event_source_url: event.eventSourceUrl,
        action_source: "website",
        user_data: {
          ...(ph ? { ph: [ph] } : {}),
          ...(em ? { em: [em] } : {}),
          ...(external_id ? { external_id: [external_id] } : {}),
          ...(event.clientIp ? { client_ip_address: event.clientIp } : {}),
          ...(event.userAgent ? { client_user_agent: event.userAgent } : {}),
          ...(event.fbp ? { fbp: event.fbp } : {}),
          ...(event.fbc ? { fbc: event.fbc } : {}),
        },
        ...(event.customData ? { custom_data: event.customData } : {}),
      },
    ],
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.warn(`[meta-capi] ${event.eventName} rejected: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return res.ok;
  } catch (error) {
    console.warn(`[meta-capi] ${event.eventName} failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}
