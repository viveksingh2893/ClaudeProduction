"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@kisan4u/db";
import {
  subcategoryInputSchema,
  activeToggleSchema,
  type CategoryNameTranslationInput,
} from "@kisan4u/validators";
import { assertNoActiveChildrenForSubcategory } from "@kisan4u/catalog";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";
import { applyCategoryNameTranslations } from "@/lib/category-name-translations";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** Bust the cached storefront category nav tree (unstable_cache tag "homepage") + this admin page. */
async function revalidateStorefront() {
  revalidatePath("/admin/subcategories");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
}

function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

/** See categories/actions.ts's uploadCategoryImageAction doc comment — same client-minted-id create-flow pattern. */
export async function uploadSubcategoryImageAction(
  id: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  if (!isSafeClientId(id)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(file, catalogImagePaths.subcategory(id, slug));
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
  const existing = await prisma.subcategory.findFirst({
    where: { OR: [{ name }, { slug }], ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return !existing;
}

export async function createSubcategoryAction(input: {
  name: string;
  slug: string;
  categoryId: string;
  imageUrl?: string;
  description?: string;
  nameTranslations?: CategoryNameTranslationInput[];
  id?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = subcategoryInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (input.id && !isSafeClientId(input.id)) return { ok: false, error: "Invalid request." };

  const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
  if (!category) return { ok: false, error: "Select a valid category." };
  if (!(await assertUnique(parsed.data.name, parsed.data.slug))) {
    return { ok: false, error: "A subcategory with this name or slug already exists." };
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.subcategory.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        name: parsed.data.name,
        slug: parsed.data.slug,
        categoryId: parsed.data.categoryId,
        imageUrl: parsed.data.imageUrl || null,
        description: parsed.data.description || null,
      },
    });
    await applyCategoryNameTranslations(tx, "subcategory", created.id, parsed.data.nameTranslations);
  });
  await revalidateStorefront();
  return { ok: true };
}

export async function updateSubcategoryAction(
  id: string,
  input: {
    name: string;
    slug: string;
    categoryId: string;
    imageUrl?: string;
    description?: string;
    nameTranslations?: CategoryNameTranslationInput[];
  },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = subcategoryInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
  if (!category) return { ok: false, error: "Select a valid category." };
  if (!(await assertUnique(parsed.data.name, parsed.data.slug, id))) {
    return { ok: false, error: "A subcategory with this name or slug already exists." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.subcategory.update({
      where: { id },
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        categoryId: parsed.data.categoryId,
        imageUrl: parsed.data.imageUrl || null,
        description: parsed.data.description || null,
      },
    });
    await applyCategoryNameTranslations(tx, "subcategory", id, parsed.data.nameTranslations);
  });
  await revalidateStorefront();
  return { ok: true };
}

/** Deactivating is blocked while any active sub-subcategory still references this subcategory. */
export async function toggleSubcategoryActiveAction(
  id: string,
  isActive: boolean,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = activeToggleSchema.safeParse({ id, isActive });
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  if (!parsed.data.isActive) {
    const check = await assertNoActiveChildrenForSubcategory(parsed.data.id);
    if (!check.ok) return check;
  }
  await prisma.subcategory.update({
    where: { id: parsed.data.id },
    data: { isActive: parsed.data.isActive },
  });
  await revalidateStorefront();
  return { ok: true };
}
