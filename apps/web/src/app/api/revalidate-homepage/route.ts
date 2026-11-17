import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/**
 * apps/web and apps/dashboard are separate Next.js server processes
 * (separate deployments in production) — a Server Action in
 * apps/dashboard calling revalidateTag("homepage") only invalidates ITS
 * OWN process's cache, never apps/web's, where getCachedHomepageModel's
 * unstable_cache actually lives (confirmed directly: an admin edit did
 * not appear on the storefront until this endpoint was added). This
 * endpoint is the cross-app bridge: apps/dashboard calls it (best-effort,
 * fire-and-forget) after every homepage-CMS/site-settings mutation. The
 * `revalidate: 60` TTL on the cache itself is the fallback safety net if
 * this call ever fails or is skipped — staleness self-heals within 60s
 * regardless.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-revalidate-secret");
  if (!secret || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  revalidateTag("homepage");
  return NextResponse.json({ ok: true });
}
