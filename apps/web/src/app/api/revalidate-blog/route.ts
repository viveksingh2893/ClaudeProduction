import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Cross-app cache bridge for blog content — same reasoning as
 * /api/revalidate-homepage (apps/web and apps/dashboard are separate
 * processes; a revalidateTag() call inside a dashboard Server Action never
 * reaches apps/web's own unstable_cache). A separate route rather than
 * extending revalidate-homepage's: that one is hardcoded to a single tag,
 * and blog changes don't need to also revalidate "homepage" (the homepage's
 * own six sections are unrelated to blog content) or vice versa.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-revalidate-secret");
  if (!secret || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  revalidateTag("blog");
  return NextResponse.json({ ok: true });
}
