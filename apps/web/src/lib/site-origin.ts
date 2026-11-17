import { headers } from "next/headers";

const DEFAULT_SITE_ORIGIN = "https://katra4u.com";

/** Uses SITE_ORIGIN in production and the real request origin in preview/local environments. */
export async function getSiteOrigin(): Promise<string> {
  const configured = process.env.SITE_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("host");
  if (!host) return DEFAULT_SITE_ORIGIN;
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function absoluteSiteUrl(path: string): Promise<string> {
  return new URL(path, `${await getSiteOrigin()}/`).toString();
}

export function toAbsoluteUrl(pathOrUrl: string, origin: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!origin) return pathOrUrl;
  return `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
