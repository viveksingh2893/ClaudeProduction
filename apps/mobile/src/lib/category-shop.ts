import type { CategoryNode } from "./api/types";

/**
 * Pure selection logic for the Shop tab's two-pane category browser,
 * factored out of the screen component so it's unit-testable without a
 * React Native renderer (this project has no component-testing framework
 * installed — see the final report — so this file is deliberately where
 * the screen's non-visual decisions live).
 */

/**
 * First active top-level category by configured position when there's no
 * prior selection (categories is already position-ordered by
 * getCategoryNavTree, so index 0 is authoritative — never re-sorted
 * here). If a previous selection is still present in the list, it's kept
 * — e.g. after a background refresh — so the user's chosen category
 * doesn't jump back to the first one under them. If the previously
 * selected category no longer exists (deactivated, deleted), falls back
 * to the first category rather than leaving nothing selected.
 */
export function resolveSelectedCategoryId(
  categories: CategoryNode[],
  previousId: string | null,
): string | null {
  if (previousId && categories.some((c) => c.id === previousId)) return previousId;
  return categories[0]?.id ?? null;
}

/** Looks up the currently selected category's full node (subcategories, images) by id — null-safe for "nothing selected yet." */
export function findCategoryById(
  categories: CategoryNode[],
  id: string | null,
): CategoryNode | null {
  if (!id) return null;
  return categories.find((c) => c.id === id) ?? null;
}
