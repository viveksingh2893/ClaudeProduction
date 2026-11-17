"use server";

import { prisma } from "@kisan4u/db";
import { manufacturerInputSchema, brandManufacturerDecisionSchema } from "@kisan4u/validators";
import { decideManufacturer } from "@kisan4u/catalog";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

/** See admin/categories/actions.ts's uploadCategoryImageAction doc comment — same client-minted-id create-flow pattern. */
export async function uploadManufacturerImageAction(
  id: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  if (!isSafeClientId(id)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(file, catalogImagePaths.manufacturer(id, slug));
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
  const existing = await prisma.manufacturer.findFirst({
    where: { OR: [{ name }, { slug }], ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return !existing;
}

/** Admin-created manufacturers are global (no owning seller) and immediately APPROVED — admin isn't "requesting" anything. */
export async function createManufacturerAction(input: {
  name: string;
  slug: string;
  imageUrl?: string;
  id?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = manufacturerInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (input.id && !isSafeClientId(input.id)) return { ok: false, error: "Invalid request." };

  if (!(await assertUnique(parsed.data.name, parsed.data.slug))) {
    return { ok: false, error: "A manufacturer with this name or slug already exists." };
  }
  await prisma.manufacturer.create({
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

export async function updateManufacturerAction(
  id: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = manufacturerInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (!(await assertUnique(parsed.data.name, parsed.data.slug, id))) {
    return { ok: false, error: "A manufacturer with this name or slug already exists." };
  }
  await prisma.manufacturer.update({
    where: { id },
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      imageUrl: parsed.data.imageUrl || null,
    },
  });
  return { ok: true };
}

export async function decideManufacturerAction(input: {
  id: string;
  action: "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "DEACTIVATE";
  reason?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = brandManufacturerDecisionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  return decideManufacturer(parsed.data.id, parsed.data.action, parsed.data.reason);
}
