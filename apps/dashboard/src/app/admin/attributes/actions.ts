"use server";

import { prisma } from "@kisan4u/db";
import { attributeInputSchema, activeToggleSchema } from "@kisan4u/validators";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function createAttributeAction(input: {
  name: string;
  slug: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = attributeInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const existing = await prisma.productAttribute.findFirst({
    where: { OR: [{ name: parsed.data.name }, { slug: parsed.data.slug }] },
  });
  if (existing) return { ok: false, error: "An attribute with this name or slug already exists." };

  await prisma.productAttribute.create({ data: parsed.data });
  return { ok: true };
}

export async function updateAttributeAction(
  id: string,
  input: { name: string; slug: string },
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = attributeInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const clash = await prisma.productAttribute.findFirst({
    where: { OR: [{ name: parsed.data.name }, { slug: parsed.data.slug }], NOT: { id } },
  });
  if (clash) return { ok: false, error: "An attribute with this name or slug already exists." };

  await prisma.productAttribute.update({ where: { id }, data: parsed.data });
  return { ok: true };
}

export async function toggleAttributeActiveAction(id: string, isActive: boolean): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = activeToggleSchema.safeParse({ id, isActive });
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  await prisma.productAttribute.update({
    where: { id: parsed.data.id },
    data: { isActive: parsed.data.isActive },
  });
  return { ok: true };
}
