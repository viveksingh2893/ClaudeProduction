"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import {
  saveHomepageSection,
  savePromotionalAsset,
  deletePromotionalAsset,
  saveCategoryHomepageAsset,
  deleteCategoryHomepageAsset,
  saveDealOfTheDay,
  deleteDealOfTheDay,
  setDiscoveryMode,
  setCollectionItems,
  addFeaturedCategory,
  removeFeaturedCategory,
  addFeaturedSubcategory,
  removeFeaturedSubcategory,
  setBrandHomepagePosition,
  searchProductsForPicker,
} from "@kisan4u/catalog";
import {
  homepageSectionInputSchema,
  promotionalAssetInputSchema,
  categoryHomepageAssetInputSchema,
  dealOfTheDayInputSchema,
} from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Every mutation here revalidates the admin page it was made from AND
 * pings the storefront (a separate Next.js process — see
 * revalidateStorefrontHomepage's doc comment) so a published change is
 * visible without waiting out the cache's 60s fallback TTL.
 * revalidateTag("homepage") here still only affects this (dashboard)
 * process's own cache, if it ever gains one — harmless no-op today, kept
 * in case a future shared cache handler makes it meaningful.
 */
async function revalidateHomepage(adminPath: string) {
  revalidatePath(adminPath);
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
}

export async function saveHomepageSectionAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = homepageSectionInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await saveHomepageSection(parsed.data);
  await revalidateHomepage("/admin/homepage");
  return { ok: true };
}

export async function savePromotionalAssetAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = promotionalAssetInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await savePromotionalAsset(parsed.data);
  await revalidateHomepage("/admin/homepage/banners");
  return { ok: true };
}

export async function deletePromotionalAssetAction(id: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  await deletePromotionalAsset(id);
  await revalidateHomepage("/admin/homepage/banners");
  return { ok: true };
}

export async function saveCategoryHomepageAssetAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = categoryHomepageAssetInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await saveCategoryHomepageAsset(parsed.data);
  await revalidateHomepage("/admin/homepage/top-categories");
  return { ok: true };
}

export async function deleteCategoryHomepageAssetAction(id: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  await deleteCategoryHomepageAsset(id);
  await revalidateHomepage("/admin/homepage/top-categories");
  return { ok: true };
}

export async function saveDealOfTheDayAction(rawInput: unknown): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = dealOfTheDayInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await saveDealOfTheDay(parsed.data);
  await revalidateHomepage("/admin/homepage/deal-of-the-day");
  return { ok: true };
}

export async function deleteDealOfTheDayAction(id: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  await deleteDealOfTheDay(id);
  await revalidateHomepage("/admin/homepage/deal-of-the-day");
  return { ok: true };
}

export async function setDiscoveryModeAction(
  collectionId: string,
  mode: "MANUAL" | "AUTOMATIC",
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setDiscoveryMode(collectionId, mode);
  await revalidateHomepage("/admin/homepage/discovery");
  return { ok: true };
}

export async function setCollectionItemsAction(
  collectionId: string,
  productIds: string[],
  max = 10,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setCollectionItems(collectionId, productIds, max);
  await revalidateHomepage("/admin/homepage/discovery");
  await revalidateHomepage("/admin/homepage/featured-by-category");
  await revalidateHomepage("/admin/homepage/featured-by-subcategory");
  return { ok: true };
}

export async function addFeaturedCategoryAction(categoryId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  try {
    await addFeaturedCategory(categoryId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add category." };
  }
  await revalidateHomepage("/admin/homepage/featured-by-category");
  return { ok: true };
}

export async function removeFeaturedCategoryAction(collectionId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  await removeFeaturedCategory(collectionId);
  await revalidateHomepage("/admin/homepage/featured-by-category");
  return { ok: true };
}

export async function addFeaturedSubcategoryAction(subCategoryId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  try {
    await addFeaturedSubcategory(subCategoryId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not add sub-category.",
    };
  }
  await revalidateHomepage("/admin/homepage/featured-by-subcategory");
  return { ok: true };
}

export async function removeFeaturedSubcategoryAction(collectionId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  await removeFeaturedSubcategory(collectionId);
  await revalidateHomepage("/admin/homepage/featured-by-subcategory");
  return { ok: true };
}

export async function setBrandHomepagePositionAction(
  brandId: string,
  homepagePosition: number | null,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setBrandHomepagePosition(brandId, homepagePosition);
  await revalidateHomepage("/admin/homepage/brands");
  return { ok: true };
}

/** Shared by the discovery/featured-by-category/deal-of-the-day product pickers. */
export async function searchProductsAction(query: string) {
  await requireSession(["ADMIN"]);
  return searchProductsForPicker(query);
}
