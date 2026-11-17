"use server";

import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  createBlog,
  updateBlog,
  createBlogCategory,
  listBlogCategories,
} from "@kisan4u/catalog";
import type { BlogInput } from "@kisan4u/validators";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontBlog } from "@/lib/revalidate-storefront";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** Same "client-minted id lets an image upload before the row exists" pattern as admin/categories/actions.ts's isSafeClientId — kept as its own small local copy rather than cross-importing a private helper from a sibling feature. */
function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

export async function uploadBlogImageAction(
  id: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  if (!isSafeClientId(id)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(file, catalogImagePaths.blog(id, slug || "blog"));
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

async function revalidateBlogEverywhere() {
  revalidatePath("/admin/blog");
  revalidateTag("blog");
  await revalidateStorefrontBlog();
}

export async function listBlogCategoriesAction() {
  await requireSession(["ADMIN"]);
  return listBlogCategories();
}

export async function createBlogCategoryAction(
  name: string,
): Promise<Result & { data?: { id: string; name: string; slug: string } }> {
  await requireSession(["ADMIN"]);
  const result = await createBlogCategory({ name });
  if (!result.ok) return result;
  await revalidateBlogEverywhere();
  return { ok: true, data: result.data };
}

/** createBlog/updateBlog (packages/catalog) already run blogInputSchema authoritatively — this layer only checks what's specific to the Server Action boundary (auth, the client-minted image id). */
export async function createBlogAction(input: BlogInput): Promise<Result> {
  await requireSession(["ADMIN"]);
  const result = await createBlog(input);
  if (!result.ok) return result;
  await revalidateBlogEverywhere();
  redirect("/admin/blog");
}

export async function updateBlogAction(id: string, input: BlogInput): Promise<Result> {
  await requireSession(["ADMIN"]);
  const result = await updateBlog(id, input);
  if (!result.ok) return result;
  await revalidateBlogEverywhere();
  redirect("/admin/blog");
}
