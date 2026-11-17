import { prisma } from "@kisan4u/db";

export type HierarchyCheckResult = { ok: true } | { ok: false; error: string };

/**
 * A product's category chain must be internally consistent — a
 * subCategory that doesn't belong to the given category (or a
 * subSubCategory that doesn't belong to the given subCategory) is
 * rejected here, server-side, regardless of what the form UI would
 * normally prevent by filtering dropdowns. Never trust the client to
 * have kept the chain consistent.
 */
export async function validateCategoryChain(
  categoryId: string,
  subCategoryId: string | null,
  subSubCategoryId: string | null,
): Promise<HierarchyCheckResult> {
  if (subCategoryId) {
    const subCategory = await prisma.subcategory.findUnique({ where: { id: subCategoryId } });
    if (!subCategory || subCategory.categoryId !== categoryId) {
      return { ok: false, error: "Selected subcategory does not belong to the selected category." };
    }
  }
  if (subSubCategoryId) {
    if (!subCategoryId) {
      return { ok: false, error: "Select a subcategory before a sub-subcategory." };
    }
    const subSubCategory = await prisma.subSubCategory.findUnique({
      where: { id: subSubCategoryId },
    });
    if (!subSubCategory || subSubCategory.subCategoryId !== subCategoryId) {
      return {
        ok: false,
        error: "Selected sub-subcategory does not belong to the selected subcategory.",
      };
    }
  }
  return { ok: true };
}

/**
 * Deactivating a category/subcategory with active children would leave
 * those children "active" but orphaned from an inactive parent's
 * effective visibility — reject the deactivation instead of silently
 * cascading, so an admin has to make an explicit decision about the
 * children first.
 */
export async function assertNoActiveChildrenForCategory(
  categoryId: string,
): Promise<HierarchyCheckResult> {
  const activeChildCount = await prisma.subcategory.count({
    where: { categoryId, isActive: true },
  });
  if (activeChildCount > 0) {
    return { ok: false, error: "Deactivate this category's active subcategories first." };
  }
  return { ok: true };
}

export async function assertNoActiveChildrenForSubcategory(
  subCategoryId: string,
): Promise<HierarchyCheckResult> {
  const activeChildCount = await prisma.subSubCategory.count({
    where: { subCategoryId, isActive: true },
  });
  if (activeChildCount > 0) {
    return { ok: false, error: "Deactivate this subcategory's active sub-subcategories first." };
  }
  return { ok: true };
}

// --- Shop by Category homepage ordering ------------------------------------
//
// Reuses Category.position (already on the model, unused by any other
// feature — seed.ts already sets it on the first few rows with exactly
// this intent, nothing else in the app reads or writes it) rather than
// adding a new field. 1-based in the admin UI/API surface; every write
// here re-ranks the WHOLE active top-level set to a clean 1..N sequence in
// one transaction, so historical gaps or duplicates self-heal on every
// call instead of needing a separate migration/backfill script. Only
// top-level Category rows participate — Subcategory/SubSubCategory don't
// get a homepage position.

async function reassignTopLevelPositions(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.category.update({ where: { id }, data: { position: i + 1 } })),
  );
}

/** Next end-of-list position for a category about to become active (newly created, or reactivated) — call before the create/update that flips it active. */
export async function getNextTopLevelCategoryPosition(): Promise<number> {
  return (await prisma.category.count({ where: { isActive: true } })) + 1;
}

/**
 * Moves `categoryId` to `newPosition` (1-based, clamped into range) among
 * currently-active top-level categories, shifting everything between the
 * old and new position by one — implemented as "remove then reinsert at
 * index" over the full active list rather than incremental shifting, so
 * it's naturally atomic (one transaction), always leaves a clean 1..N
 * range with no duplicates, and self-normalizes any pre-existing drift in
 * the same call.
 */
export async function setTopLevelCategoryPosition(
  categoryId: string,
  newPosition: number,
): Promise<HierarchyCheckResult> {
  const target = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!target || !target.isActive) return { ok: false, error: "Category not found or inactive." };

  const active = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const ids = active.map((c) => c.id).filter((id) => id !== categoryId);
  const clamped = Math.min(Math.max(Math.trunc(newPosition), 1), ids.length + 1);
  ids.splice(clamped - 1, 0, categoryId);

  await reassignTopLevelPositions(ids);
  return { ok: true };
}

/** Re-ranks active top-level categories to a clean 1..N sequence without changing their relative order — call after create/delete/activate/deactivate so a gap left behind closes up. */
export async function normalizeTopLevelCategoryPositions(): Promise<void> {
  const active = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  await reassignTopLevelPositions(active.map((c) => c.id));
}
