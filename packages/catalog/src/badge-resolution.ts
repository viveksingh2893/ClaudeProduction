/**
 * Product Card Design Spec §Badge priority: at most one badge shows per
 * card, in this fixed priority order — blocking availability > active
 * deal/offer > exceptional delivery promise > editorial (Best Seller/
 * Trending/New). A pure function so it's independently unit-testable and
 * so every caller (unified ProductCard adapter, admin preview) resolves
 * the same winner from the same inputs — never duplicated per call site.
 */
export type BadgeTone = "success" | "warning" | "danger" | "info";

export type BadgeCandidate = { text: string; tone: BadgeTone };

export function resolveCardBadge(input: {
  /** Priority 1 — e.g. Out of Stock / not available in dealer's state. Must never be hidden by a lower-priority badge. */
  availability?: BadgeCandidate | null;
  /** Priority 2 — Deal of the Day or another meaningful discount, only while genuinely valid. */
  deal?: BadgeCandidate | null;
  /** Priority 3 — an exceptional delivery promise, not a normal-delivery label. */
  delivery?: BadgeCandidate | null;
  /** Priority 4 — Best Seller / Trending / New / admin-assigned editorial badge. */
  editorial?: BadgeCandidate | null;
}): BadgeCandidate | null {
  return input.availability ?? input.deal ?? input.delivery ?? input.editorial ?? null;
}
