"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@kisan4u/db";
import { brandInputSchema, brandManufacturerDecisionSchema } from "@kisan4u/validators";
import { decideBrand, setBrandHomepagePosition } from "@kisan4u/catalog";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

/** "Shop by Brand" homepage rank, edited inline on the /admin/brands table. `position` null = not featured. See setBrandHomepagePosition for the re-numbering. */
export async function setBrandHomepagePositionAction(
  id: string,
  position: number | null,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await setBrandHomepagePosition(id, position);
  revalidatePath("/admin/brands");
  revalidateTag("homepage");
  return { ok: true };
}
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

/** See admin/categories/actions.ts's uploadCategoryImageAction doc comment — same client-minted-id create-flow pattern. */
export async function uploadBrandImageAction(
  id: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  if (!isSafeClientId(id)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(file, catalogImagePaths.brand(id, slug));
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
  const existing = await prisma.brand.findFirst({
    where: { OR: [{ name }, { slug }], ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return !existing;
}

/** Admin-created brands are global (no owning seller) and immediately APPROVED — admin isn't "requesting" anything. */
export async function createBrandAction(input: {
  name: string;
  slug: string;
  imageUrl?: string;
  id?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = brandInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (input.id && !isSafeClientId(input.id)) return { ok: false, error: "Invalid request." };

  if (!(await assertUnique(parsed.data.name, parsed.data.slug))) {
    return { ok: false, error: "A brand with this name or slug already exists." };
  }
  await prisma.brand.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      name: parsed.data.name,
      slug: parsed.data.slug,
      imageUrl: parsed.data.imageUrl || null,
      status: "APPROVED",
      ownerSellerId: null,
    },
  });
  return { ok: true };
}

export async function updateBrandAction(
  id: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = brandInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (!(await assertUnique(parsed.data.name, parsed.data.slug, id))) {
    return { ok: false, error: "A brand with this name or slug already exists." };
  }
  await prisma.brand.update({
    where: { id },
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      imageUrl: parsed.data.imageUrl || null,
    },
  });
  return { ok: true };
}

export async function decideBrandAction(input: {
  id: string;
  action: "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "DEACTIVATE";
  reason?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = brandManufacturerDecisionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  return decideBrand(parsed.data.id, parsed.data.action, parsed.data.reason);
}
