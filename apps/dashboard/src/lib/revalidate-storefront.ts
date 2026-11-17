/**
 * Cross-app cache invalidation — see apps/web/src/app/api/revalidate-homepage/route.ts
 * for why this exists (apps/web and apps/dashboard are separate Next.js
 * processes; a local revalidateTag() call here has no effect on the
 * storefront's cache). Deliberately fire-and-forget: a failed ping must
 * never fail the admin's save action — the storefront cache's own 60s TTL
 * is the fallback if this call is ever unreachable/misconfigured.
 */
export async function revalidateStorefrontHomepage(): Promise<void> {
  const baseUrl = process.env.STOREFRONT_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!baseUrl || !secret) return;

  try {
    await fetch(`${baseUrl}/api/revalidate-homepage`, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
    });
  } catch {
    // Best-effort — see doc comment above.
  }
}

/** Same bridge, blog's own tag — see apps/web/src/app/api/revalidate-blog/route.ts. Called from every blog/blog-category admin mutation so a save is visible on /blog, /blog/[slug], and the homepage carousel without waiting out the cache's own 60s TTL. */
export async function revalidateStorefrontBlog(): Promise<void> {
  const baseUrl = process.env.STOREFRONT_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!baseUrl || !secret) return;

  try {
    await fetch(`${baseUrl}/api/revalidate-blog`, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
    });
  } catch {
    // Best-effort — see revalidateStorefrontHomepage's doc comment.
  }
}
