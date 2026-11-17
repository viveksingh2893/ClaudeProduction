import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isMetaCapiConfigured, sendMetaCapiEvent } from "@/lib/meta/capi";
import { hashedUserMatch } from "@/lib/meta/user-data";
import {
  META_CONSENT_COOKIE,
  META_EVENT_NAMES,
  isTrackableHost,
  type MetaCustomData,
  type MetaEventName,
} from "@/lib/meta/shared";

/**
 * Server half of lib/meta/track.ts's trackMetaEvent: the browser fires the
 * pixel event and posts the same event (same event_id) here, and this
 * forwards it to the Conversions API with what only the server can add —
 * the visitor's IP / user agent and the signed-in buyer's hashed phone /
 * email. Does nothing unless the visitor accepted cookies.
 */
export async function POST(req: NextRequest) {
  if (!isMetaCapiConfigured()) return new NextResponse(null, { status: 204 });
  if (req.cookies.get(META_CONSENT_COOKIE)?.value !== "granted") {
    return new NextResponse(null, { status: 204 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const eventName = body.eventName;
  const eventId = body.eventId;
  const eventSourceUrl = body.eventSourceUrl;
  if (
    typeof eventName !== "string" ||
    !(META_EVENT_NAMES as readonly string[]).includes(eventName) ||
    typeof eventId !== "string" ||
    !/^[\w-]{8,64}$/.test(eventId) ||
    typeof eventSourceUrl !== "string"
  ) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(eventSourceUrl);
  } catch {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  if (!isTrackableHost(sourceUrl.hostname)) return new NextResponse(null, { status: 204 });

  const session = await auth();
  const userMatch = session?.user.id ? await hashedUserMatch(session.user.id) : {};

  await sendMetaCapiEvent({
    eventName: eventName as MetaEventName,
    eventId,
    eventSourceUrl: sourceUrl.toString(),
    userMatch,
    clientIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
    fbp: req.cookies.get("_fbp")?.value,
    fbc: req.cookies.get("_fbc")?.value,
    customData: sanitizeCustomData(body.customData),
  });
  return new NextResponse(null, { status: 204 });
}

/** Keeps only the known custom_data fields with the right types — never forwards arbitrary client JSON. */
function sanitizeCustomData(raw: unknown): MetaCustomData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  const data: MetaCustomData = {
    value: num(r.value),
    currency: r.value !== undefined ? "INR" : undefined,
    content_ids: Array.isArray(r.content_ids)
      ? r.content_ids.map((id) => str(id, 100)).filter((id): id is string => !!id).slice(0, 50)
      : undefined,
    content_type: r.content_type === "product" ? "product" : undefined,
    contents: Array.isArray(r.contents)
      ? r.contents
          .map((c) => {
            const item = (c ?? {}) as Record<string, unknown>;
            const id = str(item.id, 100);
            const quantity = num(item.quantity);
            return id && quantity ? { id, quantity, item_price: num(item.item_price) } : null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null)
          .slice(0, 50)
      : undefined,
    content_name: str(r.content_name),
    num_items: num(r.num_items),
    search_string: str(r.search_string),
    order_id: str(r.order_id, 100),
  };
  const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  return Object.keys(cleaned).length > 0 ? (cleaned as MetaCustomData) : undefined;
}
