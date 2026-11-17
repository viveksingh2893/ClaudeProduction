import { API_BASE_URL } from "./api-client";

/**
 * The mobile API returns image URLs in two shapes:
 *   - absolute  — "https://admin.kisan4u.com/storage/..." (legacy migrated
 *     assets), usable as-is
 *   - relative  — "/api/uploads/catalog-images/..." (everything served by
 *     apps/web's upload route), which React Native's <Image> can't fetch
 *
 * `resolveImageUrl` turns the relative form into an absolute URL against
 * the configured API base (https://katra4u.com), the app's equivalent of
 * the storefront's resolveStorefrontAssetUrl. Every image the app renders
 * should pass through here — SafeImage does it centrally.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(https?:|data:)/i.test(trimmed)) return trimmed;
  if (!API_BASE_URL) return trimmed;
  return `${API_BASE_URL.replace(/\/$/, "")}/${trimmed.replace(/^\//, "")}`;
}
