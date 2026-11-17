"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@kisan4u/db";
import {
  subSubCategoryInputSchema,
  activeToggleSchema,
  type CategoryNameTranslationInput,
} from "@kisan4u/validators";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";
import { applyCategoryNameTranslations } from "@/lib/category-name-translations";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

async function revalidateStorefront() {
  revalidatePath("/admin/sub-subcategories");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
}

function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

/** See categories/actions.ts's uploadCategoryImageAction doc comment — same client-minted-id create-flow pattern. */
export async function uploadSubSubCategoryImageAction(
  id: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  if (!isSafeClientId(id)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(file, catalogImagePaths.subSubcategory(id, slug));
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
  const existing = await prisma.subSubCategory.findFirst({
    where: { OR: [{ name }, { slug }], ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return !existing;
}

export async function createSubSubCategoryAction(input: {
  name: string;
  slug: string;
  subCategoryId: string;
  imageUrl?: string;
  description?: string;
  nameTranslations?: CategoryNameTranslationInput[];
  id?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = subSubCategoryInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (input.id && !isSafeClientId(input.id)) return { ok: false, error: "Invalid request." };

  const subCategory = await prisma.subcategory.findUnique({
    where: { id: parsed.data.subCategoryId },
  });
  if (!subCategory) return { ok: false, error: "Select a valid subcategory." };
  if (!(await assertUnique(parsed.data.name, parsed.data.slug))) {
    return { ok: false, error: "A sub-subcategory with this name or slug already exists." };
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.subSubCategory.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        name: parsed.data.name,
        slug: parsed.data.slug,
        subCategoryId: parsed.data.subCategoryId,
        imageUrl: parsed.data.imageUrl || null,
        description: parsed.data.description || null,
      },
    });
    await applyCategoryNameTranslations(
      tx,
      "subSubCategory",
      created.id,
      parsed.data.nameTranslations,
    );
  });
  await revalidateStorefront();
  return { ok: true };
}

export async function updateSubSubCategoryAction(
  id: string,
  input: {
    name: string;
    slug: string;
    subCategoryId: string;
    imageUrl?: string;
    description?: string;
    nameTranslations?: CategoryNameTranslationInput[];
  },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = subSubCategoryInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const subCategory = await prisma.subcategory.findUnique({
    where: { id: parsed.data.subCategoryId },
  });
  if (!subCategory) return { ok: false, error: "Select a valid subcategory." };
  if (!(await assertUnique(parsed.data.name, parsed.data.slug, id))) {
    return { ok: false, error: "A sub-subcategory with this name or slug already exists." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.subSubCategory.update({
      where: { id },
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        subCategoryId: parsed.data.subCategoryId,
        imageUrl: parsed.data.imageUrl || null,
        description: parsed.data.description || null,
      },
    });
    await applyCategoryNameTranslations(tx, "subSubCategory", id, parsed.data.nameTranslations);
  });
  await revalidateStorefront();
  return { ok: true };
}

/**
 * No active-children guard needed here — SubSubCategory is the deepest
 * level in the fixed 3-level hierarchy, so it has no children of its own
 * (a Product referencing it stays untouched either way; deactivating just
 * hides it from the catalogue's active dropdown/filter options).
 */
export async function toggleSubSubCategoryActiveAction(
  id: string,
  isActive: boolean,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = activeToggleSchema.safeParse({ id, isActive });
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  await prisma.subSubCategory.update({
    where: { id: parsed.data.id },
    data: { isActive: parsed.data.isActive },
  });
  await revalidateStorefront();
  return { ok: true };
}
