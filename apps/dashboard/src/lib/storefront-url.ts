/**
 * Dealer/seller KYC document urls (gstDocUrl, licenseDocUrl, panDocUrl) —
 * and, identically, every uploaded catalog/product/variant image url —
 * are stored as paths relative to apps/web (e.g. "/api/uploads/..." or
 * seed data's "/demo/docs/..."), because that's the app that actually
 * serves them (see packages/providers/src/storage.ts's doc comment).
 * apps/dashboard is a *separate* Next.js app on its own origin/port — a
 * bare relative href rendered here resolves against dashboard's own
 * origin instead, which 404s. Resolve to an absolute storefront url
 * before handing it to a browser.
 *
 * Split into a pure core (`buildStorefrontAssetUrl`, no `process.env`
 * access) and this env-reading wrapper so the exact same resolution logic
 * is safely importable from a "use client" component too — reading
 * `process.env.STOREFRONT_PUBLIC_URL` directly from client code would
 * silently evaluate to `undefined` (only `NEXT_PUBLIC_*` vars are inlined
 * into the client bundle), which is exactly how product-form.tsx's
 * uploaded-image previews went on 404ing after save: nothing was ever
 * resolving them client-side. A client caller instead receives the base
 * url as an ordinary prop (read server-side, where `process.env` works)
 * and calls `buildStorefrontAssetUrl` itself.
 */
export function buildStorefrontAssetUrl(
  url: string,
  base: string | null | undefined,
): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function resolveStorefrontAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return buildStorefrontAssetUrl(url, process.env.STOREFRONT_PUBLIC_URL);
}
