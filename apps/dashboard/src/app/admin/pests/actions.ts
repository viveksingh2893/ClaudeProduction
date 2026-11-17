"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { pestDiseaseInputSchema, activeToggleSchema } from "@kisan4u/validators";
import {
  createPestDisease,
  updatePestDisease,
  togglePestDiseaseActive,
} from "@kisan4u/catalog";
import { uploadCatalogImage, catalogImagePaths, validateTagIconPng } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** Only ever a client-minted crypto.randomUUID() (see master-data-manager.tsx). Mirrors uploadCategoryImageAction. */
function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

async function revalidateStorefront() {
  revalidatePath("/admin/pests");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
}

export async function uploadPestDiseaseImageAction(
  id: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  if (!isSafeClientId(id)) return { ok: false, error: "Invalid request." };

  // Shown in place of the emoji on the home page strip — see validateTagIconPng.
  const iconError = await validateTagIconPng(file);
  if (iconError) {
    return {
      ok: false,
      error:
        iconError === "NOT_PNG"
          ? "Upload a PNG image (background removed)."
          : iconError === "NOT_SQUARE"
            ? "The image must be square (1:1)."
            : "The image needs a transparent background — remove the background first.",
    };
  }

  const result = await uploadCatalogImage(file, catalogImagePaths.pestDisease(id, slug));
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

export async function createPestDiseaseAction(input: {
  name: string;
  slug: string;
  imageUrl?: string;
  emoji?: string;
  id?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = pestDiseaseInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!parsed.data.emoji && !parsed.data.imageUrl)
    return { ok: false, error: "Add an image (or an emoji until the image is ready)." };
  if (input.id && !isSafeClientId(input.id)) return { ok: false, error: "Invalid request." };

  const result = await createPestDisease({ ...parsed.data, id: input.id });
  if (!result.ok) return result;
  await revalidateStorefront();
  return { ok: true };
}

export async function updatePestDiseaseAction(
  id: string,
  input: { name: string; slug: string; imageUrl?: string; emoji?: string },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = pestDiseaseInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!parsed.data.emoji && !parsed.data.imageUrl)
    return { ok: false, error: "Add an image (or an emoji until the image is ready)." };

  const result = await updatePestDisease(id, parsed.data);
  if (!result.ok) return result;
  await revalidateStorefront();
  return { ok: true };
}

export async function togglePestDiseaseActiveAction(
  id: string,
  isActive: boolean,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = activeToggleSchema.safeParse({ id, isActive });
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  const result = await togglePestDiseaseActive(parsed.data.id, parsed.data.isActive);
  if (!result.ok) return result;
  await revalidateStorefront();
  return { ok: true };
}
