import { NextRequest, NextResponse } from "next/server";
import { setReferralCookie } from "@/lib/referral-cookie";

/**
 * Business Associate shareable link: `https://<host>/r/<CODE>`.
 *
 * Stores the code in a short-lived cookie and forwards to the customer
 * sign-in page with the referral field pre-filled (via the `ref` query
 * param the login page reads). On a phone with the app installed and
 * Android App Links / iOS Universal Links verified, the OS opens the app
 * for this URL instead of the browser (see the app's `r/[code]` route and
 * `.well-known/assetlinks.json` / `apple-app-site-association`).
 */

/**
 * The real public origin. Next runs behind a reverse proxy (localhost:3000),
 * so `req.nextUrl.origin` is `http://localhost:3000` — using it for the
 * redirect sends the browser to localhost. Prefer the proxy's forwarded
 * headers, then the configured AUTH_URL, then the raw request as a last
 * resort.
 */
function publicOrigin(req: NextRequest): string {
  const xfProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const xfHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (xfHost) return `${xfProto || "https"}://${xfHost}`;
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/$/, "");
  const host = req.headers.get("host");
  if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    return `${xfProto || "https"}://${host}`;
  }
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const clean = (code ?? "").trim().toUpperCase().slice(0, 16);
  const valid = /^BA-[0-9A-F]{12}$/.test(clean);

  if (valid) {
    await setReferralCookie(clean);
  }
  const dest = valid ? `/login/mobile?ref=${encodeURIComponent(clean)}` : "/login/mobile";
  return NextResponse.redirect(new URL(dest, publicOrigin(req)));
}
