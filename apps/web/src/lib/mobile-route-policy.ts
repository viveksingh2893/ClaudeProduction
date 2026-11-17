export const PUBLIC_MOBILE_PREFIXES = [
  "/api/mobile/v1/auth/",
  "/api/mobile/v1/catalog/",
  "/api/mobile/v1/dealer/register/",
  "/api/mobile/v1/documents/download/",
] as const;

export const PUBLIC_MOBILE_EXACT = new Set([
  "/api/mobile/v1/site-settings",
  "/api/mobile/v1/states",
  "/api/mobile/v1/dealer/register",
  "/api/mobile/v1/dealer/status",
]);

export function isPublicMobileRoute(pathname: string): boolean {
  return (
    PUBLIC_MOBILE_EXACT.has(pathname) ||
    PUBLIC_MOBILE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
