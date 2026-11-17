"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@kisan4u/db";
import { editorialBadgeInputSchema, activeToggleSchema } from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";

type Result = { ok: true } | { ok: false; error: string };

async function afterChange() {
  revalidatePath("/admin/site-settings/editorial-badges");
  revalidatePath("/admin/products");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
}

export async function createEditorialBadgeAction(input: {
  name: string;
  slug: string;
  tone: string;
  kind: string;
  position: number;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = editorialBadgeInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const clash = await prisma.editorialBadge.findFirst({
    where: { OR: [{ name: parsed.data.name }, { slug: parsed.data.slug }] },
  });
  if (clash) return { ok: false, error: "A badge with this name or slug already exists." };

  await prisma.editorialBadge.create({ data: parsed.data });
  await afterChange();
  return { ok: true };
}

export async function updateEditorialBadgeAction(
  id: string,
  input: { name: string; slug: string; tone: string; kind: string; position: number },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = editorialBadgeInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const clash = await prisma.editorialBadge.findFirst({
    where: { OR: [{ name: parsed.data.name }, { slug: parsed.data.slug }], NOT: { id } },
  });
  if (clash) return { ok: false, error: "A badge with this name or slug already exists." };

  await prisma.editorialBadge.update({ where: { id }, data: parsed.data });
  await afterChange();
  return { ok: true };
}

/**
 * Deactivate/reactivate only — spec item #3: "Do not hard-delete a badge
 * already assigned to products." There's no delete action at all here,
 * matching the existing attribute/master-data convention (see
 * apps/dashboard/src/app/admin/attributes/actions.ts) — deactivating is
 * the only removal path, and an already-assigned product keeps loading
 * its badge correctly regardless of this flag (see ProductForm's
 * "existing assignments must continue to load correctly while editing").
 */
export async function toggleEditorialBadgeActiveAction(
  id: string,
  isActive: boolean,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = activeToggleSchema.safeParse({ id, isActive });
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  await prisma.editorialBadge.update({
    where: { id: parsed.data.id },
    data: { isActive: parsed.data.isActive },
  });
  await afterChange();
  return { ok: true };
}
