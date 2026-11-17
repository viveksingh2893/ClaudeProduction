import type { RapidShypLabelFetch } from "@kisan4u/orders";

/**
 * Turns a RapidShypLabelFetch into a PDF download response — the label
 * counterpart to invoiceResultToResponse. RapidShyp returns a hosted URL
 * (public S3), so this proxies the bytes through rather than redirecting:
 * it keeps the download same-origin, forces a sensible filename, and does
 * not leak the raw storage URL to the browser. { ok: false } becomes a
 * plain 404, mirroring the invoice helper.
 */
export async function rapidShypLabelToResponse(fetched: RapidShypLabelFetch): Promise<Response> {
  if (!fetched.ok) return new Response(fetched.error, { status: 404 });
  const upstream = await fetch(fetched.url).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("Could not retrieve the label from RapidShyp.", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/pdf",
      "Content-Disposition": `attachment; filename="shipping-label-${fetched.orderNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
