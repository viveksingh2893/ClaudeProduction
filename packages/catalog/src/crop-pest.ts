import { prisma } from "@kisan4u/db";
import type { CropInput, PestDiseaseInput } from "@kisan4u/validators";

/**
 * Homepage redesign, phase B (#5 Crop, #6 Pest & Disease). Two flat
 * admin-curated masters with an identical shape — a name, a required emoji
 * placeholder, an optional real image, an active flag and a display
 * `position`. They drive one single-line homepage strip each and an
 * audience-aware landing page (`/crops/[slug]`, `/pest-disease/[slug]`).
 * Tagging a product with them is pure merchandising — see
 * packages/catalog/src/product-submission.ts, where unknown ids are
 * dropped rather than rejected.
 */

export type CropPestResult = { ok: true } | { ok: false; error: string };

export type CropPestListItem = {
  id: string;
  name: string;
  slug: string;
  emoji: string | null;
  imageUrl: string | null;
  position: number;
  isActive: boolean;
  productCount: number;
};

export type CropPestChip = {
  id: string;
  name: string;
  slug: string;
  emoji: string | null;
  imageUrl: string | null;
};

const CHIP_SELECT = {
  id: true,
  name: true,
  slug: true,
  emoji: true,
  imageUrl: true,
} as const;

// --- Crop -----------------------------------------------------------------

export async function listCropsForAdmin(): Promise<CropPestListItem[]> {
  const rows = await prisma.crop.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    emoji: c.emoji,
    imageUrl: c.imageUrl,
    position: c.position,
    isActive: c.isActive,
    productCount: c._count.products,
  }));
}

/** Storefront homepage strip + landing-page nav — active crops in display order. */
export async function getActiveCrops(): Promise<CropPestChip[]> {
  return prisma.crop.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: CHIP_SELECT,
  });
}

export async function getCropBySlug(slug: string): Promise<CropPestChip | null> {
  return prisma.crop.findFirst({ where: { slug, isActive: true }, select: CHIP_SELECT });
}

async function assertCropUnique(name: string, slug: string, excludeId?: string) {
  const clash = await prisma.crop.findFirst({
    where: { OR: [{ name }, { slug }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  });
  return !clash;
}

export async function createCrop(
  input: CropInput & { id?: string },
): Promise<CropPestResult> {
  if (!(await assertCropUnique(input.name, input.slug))) {
    return { ok: false, error: "A crop with this name or slug already exists." };
  }
  const position = (await prisma.crop.count()) + 1;
  await prisma.crop.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      slug: input.slug,
      emoji: input.emoji || null,
      imageUrl: input.imageUrl || null,
      position,
    },
  });
  return { ok: true };
}

export async function updateCrop(id: string, input: CropInput): Promise<CropPestResult> {
  if (!(await assertCropUnique(input.name, input.slug, id))) {
    return { ok: false, error: "A crop with this name or slug already exists." };
  }
  await prisma.crop.update({
    where: { id },
    data: {
      name: input.name,
      slug: input.slug,
      emoji: input.emoji || null,
      imageUrl: input.imageUrl || null,
    },
  });
  return { ok: true };
}

export async function toggleCropActive(id: string, isActive: boolean): Promise<CropPestResult> {
  await prisma.crop.update({ where: { id }, data: { isActive } });
  return { ok: true };
}

// --- Pest & Disease -----------------------------------------------------------

export async function listPestsDiseasesForAdmin(): Promise<CropPestListItem[]> {
  const rows = await prisma.pestDisease.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    emoji: p.emoji,
    imageUrl: p.imageUrl,
    position: p.position,
    isActive: p.isActive,
    productCount: p._count.products,
  }));
}

export async function getActivePestsDiseases(): Promise<CropPestChip[]> {
  return prisma.pestDisease.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: CHIP_SELECT,
  });
}

export async function getPestDiseaseBySlug(slug: string): Promise<CropPestChip | null> {
  return prisma.pestDisease.findFirst({ where: { slug, isActive: true }, select: CHIP_SELECT });
}

async function assertPestDiseaseUnique(name: string, slug: string, excludeId?: string) {
  const clash = await prisma.pestDisease.findFirst({
    where: { OR: [{ name }, { slug }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  });
  return !clash;
}

export async function createPestDisease(
  input: PestDiseaseInput & { id?: string },
): Promise<CropPestResult> {
  if (!(await assertPestDiseaseUnique(input.name, input.slug))) {
    return { ok: false, error: "A pest or disease with this name or slug already exists." };
  }
  const position = (await prisma.pestDisease.count()) + 1;
  await prisma.pestDisease.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      slug: input.slug,
      emoji: input.emoji || null,
      imageUrl: input.imageUrl || null,
      position,
    },
  });
  return { ok: true };
}

export async function updatePestDisease(
  id: string,
  input: PestDiseaseInput,
): Promise<CropPestResult> {
  if (!(await assertPestDiseaseUnique(input.name, input.slug, id))) {
    return { ok: false, error: "A pest or disease with this name or slug already exists." };
  }
  await prisma.pestDisease.update({
    where: { id },
    data: {
      name: input.name,
      slug: input.slug,
      emoji: input.emoji || null,
      imageUrl: input.imageUrl || null,
    },
  });
  return { ok: true };
}

export async function togglePestDiseaseActive(
  id: string,
  isActive: boolean,
): Promise<CropPestResult> {
  await prisma.pestDisease.update({ where: { id }, data: { isActive } });
  return { ok: true };
}

/** Product-form reference lists — every crop/pest, active first then by name, for the multi-select. */
export async function getCropPestReferenceData(): Promise<{
  crops: { id: string; name: string }[];
  pestsDiseases: { id: string; name: string }[];
}> {
  const [crops, pestsDiseases] = await Promise.all([
    prisma.crop.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.pestDisease.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { crops, pestsDiseases };
}
