"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@kisan4u/db";
import { categoryInputSchema, activeToggleSchema } from "@kisan4u/validators";
import {
  assertNoActiveChildrenForCategory,
  getNextTopLevelCategoryPosition,
  setTopLevelCategoryPosition,
  normalizeTopLevelCategoryPositions,
} from "@kisan4u/catalog";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";
import { applyCategoryNameTranslations } from "@/lib/category-name-translations";
import type { CategoryNameTranslationInput } from "@kisan4u/validators";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** Only ever a client-minted crypto.randomUUID() (see master-data-manager.tsx) used as this row's real primary key when the admin uploads an image before the category exists yet — never client-supplied free text passed straight into a path/PK without shape-checking. */
function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

/**
 * Spec §3 — a brand-new category may get an image uploaded before the
 * "Create" button is ever clicked, but the category row (and its real id)
 * doesn't exist yet at that point. Rather than a temp-folder-then-move
 * dance, the form mints a stable client-side id up front the first time
 * an upload happens during creation and this action uploads straight into
 * that id's final folder; createCategoryAction is then asked to insert
 * the new row using that exact same id as its primary key (Prisma accepts
 * an explicit `id` on a `@default(cuid())` field), so the folder the image
 * already lives under is correct from the very first upload — no move,
 * no orphan, no mismatch. When editing an existing category, `id` is just
 * its real id, uploaded to immediately.
 */
export async function uploadCategoryImageAction(
  id: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  if (!isSafeClientId(id)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(file, catalogImagePaths.category(id, slug));
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "FILE_TOO_LARGE"
          ? "File is too large — the maximum size is 5MB."
          : result.error === "SIGNATURE_MISMATCH"
            ? "This file doesn't look like a real image."
            : "Unsupported file type — upload a JPEG, PNG, or WEBP image.",
    };
  }
  return { ok: true, url: result.url };
}

async function assertUnique(name: string, slug: string, excludeId?: string) {
  const existing = await prisma.category.findFirst({
    where: { OR: [{ name }, { slug }], ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return !existing;
}

/**
 * The category nav bar and "Shop by Category" both read Category fresh on
 * every request (see their own doc comments) — no unstable_cache in the
 * way — so this is defensive/explicit rather than load-bearing today.
 * Kept so a category-ordering change is revalidated the same way every
 * other homepage-affecting admin mutation already is (mirrors
 * admin/banners's revalidateBanners), in case that ever changes.
 */
async function revalidateStorefront() {
  revalidatePath("/admin/categories");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
}

export async function createCategoryAction(input: {
  name: string;
  slug: string;
  imageUrl?: string;
  emoji?: string;
  description?: string;
  nameTranslations?: CategoryNameTranslationInput[];
  /** See uploadCategoryImageAction's doc comment — only ever a client-minted id already used as the folder identity for an image uploaded before this row existed. */
  id?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!parsed.data.emoji) return { ok: false, error: "An emoji is required for a category." };
  if (input.id && !isSafeClientId(input.id)) return { ok: false, error: "Invalid request." };

  if (!(await assertUnique(parsed.data.name, parsed.data.slug))) {
    return { ok: false, error: "A category with this name or slug already exists." };
  }
  // New top-level categories land at the end of the Shop by Category order by default.
  const position = await getNextTopLevelCategoryPosition();
  await prisma.$transaction(async (tx) => {
    const created = await tx.category.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        name: parsed.data.name,
        slug: parsed.data.slug,
        imageUrl: parsed.data.imageUrl || null,
        emoji: parsed.data.emoji,
        description: parsed.data.description || null,
        position,
      },
    });
    await applyCategoryNameTranslations(tx, "category", created.id, parsed.data.nameTranslations);
  });
  await revalidateStorefront();
  return { ok: true };
}

export async function updateCategoryAction(
  id: string,
  input: {
    name: string;
    slug: string;
    imageUrl?: string;
    emoji?: string;
    description?: string;
    nameTranslations?: CategoryNameTranslationInput[];
  },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!parsed.data.emoji) return { ok: false, error: "An emoji is required for a category." };

  if (!(await assertUnique(parsed.data.name, parsed.data.slug, id))) {
    return { ok: false, error: "A category with this name or slug already exists." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.category.update({
      where: { id },
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        imageUrl: parsed.data.imageUrl || null,
        emoji: parsed.data.emoji,
        description: parsed.data.description || null,
      },
    });
    await applyCategoryNameTranslations(tx, "category", id, parsed.data.nameTranslations);
  });
  await revalidateStorefront();
  return { ok: true };
}

/**
 * Deactivating is blocked while any active subcategory still references
 * this category (see packages/catalog). Activating/deactivating both
 * change the active top-level set, so both re-rank it afterward:
 * deactivating closes the gap it leaves behind; activating (re-)joins the
 * Shop by Category order at the end, same as a brand-new category.
 */
export async function toggleCategoryActiveAction(id: string, isActive: boolean): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = activeToggleSchema.safeParse({ id, isActive });
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  if (!parsed.data.isActive) {
    const check = await assertNoActiveChildrenForCategory(parsed.data.id);
    if (!check.ok) return check;
    await prisma.category.update({ where: { id: parsed.data.id }, data: { isActive: false } });
    await normalizeTopLevelCategoryPositions();
  } else {
    const position = await getNextTopLevelCategoryPosition();
    await prisma.category.update({
      where: { id: parsed.data.id },
      data: { isActive: true, position },
    });
  }
  await revalidateStorefront();
  return { ok: true };
}

/** Homepage ("Shop by Category") display-order change — see setTopLevelCategoryPosition's doc comment for the reorder algorithm. */
export async function setCategoryHomepagePositionAction(
  categoryId: string,
  position: number,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  if (!Number.isInteger(position) || position < 1) return { ok: false, error: "Invalid position." };
  const result = await setTopLevelCategoryPosition(categoryId, position);
  if (!result.ok) return result;
  await revalidateStorefront();
  return { ok: true };
}
