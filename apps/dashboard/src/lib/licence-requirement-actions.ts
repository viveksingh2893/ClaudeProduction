"use server";

import { revalidatePath } from "next/cache";
import {
  getTaxonomyNodeLicenceRequirements,
  previewTaxonomyNodeLicenceImpact,
  createLicenceRequirement,
  renameLicenceRequirement,
  reviseLicenceRequirement,
  deleteLicenceRequirement,
  type LicenceRequirementRevision,
} from "@kisan4u/catalog";
import {
  licenceRequirementInputSchema,
  licenceRequirementNameUpdateSchema,
  type LicenceRequirementInput,
} from "@kisan4u/validators";
import { requireSession } from "./session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function getTaxonomyNodeLicenceRequirementsAction(
  nodeType: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY",
  nodeId: string,
) {
  await requireSession(["ADMIN"]);
  return getTaxonomyNodeLicenceRequirements(nodeType, nodeId);
}

export async function previewTaxonomyNodeLicenceImpactAction(
  nodeType: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY",
  nodeId: string,
) {
  await requireSession(["ADMIN"]);
  return previewTaxonomyNodeLicenceImpact(nodeType, nodeId);
}

function revalidateTaxonomyPages() {
  revalidatePath("/admin/categories");
  revalidatePath("/admin/subcategories");
  revalidatePath("/admin/sub-subcategories");
}

export async function createLicenceRequirementAction(
  input: LicenceRequirementInput,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const parsed = licenceRequirementInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await createLicenceRequirement(parsed.data, { id: session.user.id });
  if (!result.ok) return result;
  revalidateTaxonomyPages();
  return { ok: true };
}

export async function renameLicenceRequirementAction(input: {
  id: string;
  name: string;
}): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const parsed = licenceRequirementNameUpdateSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await renameLicenceRequirement(parsed.data.id, parsed.data.name, {
    id: session.user.id,
  });
  if (!result.ok) return result;
  revalidateTaxonomyPages();
  return { ok: true };
}

export async function reviseLicenceRequirementAction(
  id: string,
  changes: LicenceRequirementRevision,
  reason: string,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  if (!reason.trim()) return { ok: false, error: "A reason is required for this change." };
  const result = await reviseLicenceRequirement(id, changes, reason, { id: session.user.id });
  if (!result.ok) return result;
  revalidateTaxonomyPages();
  return { ok: true };
}

export async function deleteLicenceRequirementAction(id: string): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await deleteLicenceRequirement(id, { id: session.user.id });
  if (!result.ok) return result;
  revalidateTaxonomyPages();
  return { ok: true };
}
