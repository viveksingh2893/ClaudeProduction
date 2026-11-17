import { prisma } from "@kisan4u/db";
import type { TaxonomyNodeType, LicenceGeoType } from "@kisan4u/db";
import type { LicenceRequirementInput } from "@kisan4u/validators";
import { writeAuditLog } from "./audit";
import { reconcileTaxonomyNodeCompliance } from "./licence-compliance";

export type LicenceRequirementResult =
  { ok: true; requirementId: string } | { ok: false; error: string };

async function resolveNodeAncestry(
  nodeType: TaxonomyNodeType,
  nodeId: string,
): Promise<{ categoryId: string | null; subCategoryId: string | null }> {
  if (nodeType === "CATEGORY") return { categoryId: nodeId, subCategoryId: null };
  if (nodeType === "SUBCATEGORY") {
    const sub = await prisma.subcategory.findUnique({
      where: { id: nodeId },
      select: { categoryId: true },
    });
    return { categoryId: sub?.categoryId ?? null, subCategoryId: nodeId };
  }
  const subsub = await prisma.subSubCategory.findUnique({
    where: { id: nodeId },
    select: { subCategoryId: true, subCategory: { select: { categoryId: true } } },
  });
  return {
    categoryId: subsub?.subCategory.categoryId ?? null,
    subCategoryId: subsub?.subCategoryId ?? null,
  };
}

/** Direct (current-version, active or inactive) requirements at exactly this node, plus active requirements inherited from its ancestors — the shape the "Configure licences" modal needs (spec §2: "display inherited requirements separately as read-only information ... clearly label each requirement"). */
export async function getTaxonomyNodeLicenceRequirements(
  nodeType: TaxonomyNodeType,
  nodeId: string,
) {
  const ancestry = await resolveNodeAncestry(nodeType, nodeId);

  const direct = await prisma.licenceRequirement.findMany({
    where: { taxonomyNodeType: nodeType, taxonomyNodeId: nodeId, nextVersion: { is: null } },
    orderBy: { createdAt: "asc" },
  });

  const inherited: { requirement: (typeof direct)[number]; source: "CATEGORY" | "SUBCATEGORY" }[] =
    [];
  if (nodeType !== "CATEGORY" && ancestry.categoryId) {
    const categoryReqs = await prisma.licenceRequirement.findMany({
      where: {
        taxonomyNodeType: "CATEGORY",
        taxonomyNodeId: ancestry.categoryId,
        isActive: true,
        nextVersion: { is: null },
      },
    });
    inherited.push(...categoryReqs.map((r) => ({ requirement: r, source: "CATEGORY" as const })));
  }
  if (nodeType === "SUBSUBCATEGORY" && ancestry.subCategoryId) {
    const subReqs = await prisma.licenceRequirement.findMany({
      where: {
        taxonomyNodeType: "SUBCATEGORY",
        taxonomyNodeId: ancestry.subCategoryId,
        isActive: true,
        nextVersion: { is: null },
      },
    });
    inherited.push(...subReqs.map((r) => ({ requirement: r, source: "SUBCATEGORY" as const })));
  }

  return { direct, inherited };
}

/** "Does this node have active direct licence requirements" — the toggle in the taxonomy form is always derived from this, never a stored boolean (spec §2). */
export async function taxonomyNodeHasActiveLicenceRequirements(
  nodeType: TaxonomyNodeType,
  nodeId: string,
): Promise<boolean> {
  const count = await prisma.licenceRequirement.count({
    where: {
      taxonomyNodeType: nodeType,
      taxonomyNodeId: nodeId,
      isActive: true,
      nextVersion: { is: null },
    },
  });
  return count > 0;
}

/** Honest scope count for the impact-preview step before an admin confirms activating a first requirement or materially changing an existing one (spec §2/§11) — every seller/product currently listed under this node (which cascades to every descendant for CATEGORY/SUBCATEGORY nodes). */
export async function previewTaxonomyNodeLicenceImpact(
  nodeType: TaxonomyNodeType,
  nodeId: string,
): Promise<{ affectedSellerCount: number; affectedProductCount: number }> {
  const where =
    nodeType === "CATEGORY"
      ? { categoryId: nodeId }
      : nodeType === "SUBCATEGORY"
        ? { subCategoryId: nodeId }
        : { subSubCategoryId: nodeId };
  const products = await prisma.product.findMany({
    where: { ...where, sellerId: { not: null } },
    select: { sellerId: true },
  });
  return {
    affectedSellerCount: new Set(products.map((p) => p.sellerId)).size,
    affectedProductCount: products.length,
  };
}

export async function createLicenceRequirement(
  input: LicenceRequirementInput,
  actor: { id: string },
): Promise<LicenceRequirementResult> {
  const created = await prisma.licenceRequirement.create({
    data: {
      taxonomyNodeType: input.taxonomyNodeType,
      taxonomyNodeId: input.taxonomyNodeId,
      name: input.name,
      customerRequired: input.customerRequired,
      customerGeoType: input.customerRequired ? (input.customerGeoType ?? null) : null,
      dealerRequired: input.dealerRequired,
      dealerGeoType: input.dealerRequired ? (input.dealerGeoType ?? null) : null,
      sameLicenceForBothAudiences: input.sameLicenceForBothAudiences,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: "LICENCE_REQUIREMENT_CREATED",
    entityType: "LicenceRequirement",
    entityId: created.id,
    metadata: {
      taxonomyNodeType: input.taxonomyNodeType,
      taxonomyNodeId: input.taxonomyNodeId,
      name: input.name,
    },
  });
  await reconcileTaxonomyNodeCompliance(
    input.taxonomyNodeType,
    input.taxonomyNodeId,
    "REQUIREMENT_ACTIVATED",
    created.id,
  );

  return { ok: true, requirementId: created.id };
}

/** Cosmetic-only edit — never versions (see schema.prisma doc comment on LicenceRequirement). */
export async function renameLicenceRequirement(
  id: string,
  name: string,
  actor: { id: string },
): Promise<LicenceRequirementResult> {
  const updated = await prisma.licenceRequirement.update({
    where: { id },
    data: { name, updatedById: actor.id },
  });
  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: "LICENCE_REQUIREMENT_RENAMED",
    entityType: "LicenceRequirement",
    entityId: id,
    metadata: { name },
  });
  return { ok: true, requirementId: updated.id };
}

export type LicenceRequirementRevision = {
  name?: string;
  customerRequired?: boolean;
  customerGeoType?: LicenceGeoType | null;
  dealerRequired?: boolean;
  dealerGeoType?: LicenceGeoType | null;
  sameLicenceForBothAudiences?: boolean;
  isActive?: boolean;
};

/**
 * Any material change (audience, geo type, sameLicenceForBothAudiences, or
 * active/inactive) — never mutates the row, always closes it out and
 * inserts version + 1 (spec §2 "Deactivating or changing a requirement" —
 * "Do not permanently delete historical definitions or approvals",
 * "Material changes must create a new version"). Every existing
 * SellerLicenceSubmission keeps its requirementId pointing at the OLD
 * (now superseded) version, so a past approval is never silently
 * reinterpreted under the new rules — a submission approved against the
 * old version stays valid against exactly what it was approved for; the
 * new version only starts applying to future submissions and to
 * eligibility checks (via reconcileTaxonomyNodeCompliance below, which
 * re-derives every affected product from the CURRENT — new — version).
 */
export async function reviseLicenceRequirement(
  id: string,
  changes: LicenceRequirementRevision,
  reason: string,
  actor: { id: string },
): Promise<LicenceRequirementResult> {
  const current = await prisma.licenceRequirement.findUnique({
    where: { id },
    include: { nextVersion: { select: { id: true } } },
  });
  if (!current) return { ok: false, error: "Licence requirement not found." };
  if (current.nextVersion)
    return {
      ok: false,
      error: "This requirement has already been revised — edit the latest version instead.",
    };
  if (!reason.trim()) return { ok: false, error: "A reason is required for this change." };

  const merged = {
    name: changes.name ?? current.name,
    isActive: changes.isActive ?? current.isActive,
    customerRequired: changes.customerRequired ?? current.customerRequired,
    customerGeoType:
      changes.customerGeoType !== undefined ? changes.customerGeoType : current.customerGeoType,
    dealerRequired: changes.dealerRequired ?? current.dealerRequired,
    dealerGeoType:
      changes.dealerGeoType !== undefined ? changes.dealerGeoType : current.dealerGeoType,
    sameLicenceForBothAudiences:
      changes.sameLicenceForBothAudiences ?? current.sameLicenceForBothAudiences,
  };
  if (merged.isActive) {
    if (!merged.customerRequired && !merged.dealerRequired)
      return { ok: false, error: "Select at least one audience." };
    if (merged.customerRequired && !merged.customerGeoType)
      return { ok: false, error: "Select a geography rule for Customer." };
    if (merged.dealerRequired && !merged.dealerGeoType)
      return { ok: false, error: "Select a geography rule for Dealer." };
  }

  const next = await prisma.licenceRequirement.create({
    data: {
      taxonomyNodeType: current.taxonomyNodeType,
      taxonomyNodeId: current.taxonomyNodeId,
      name: merged.name,
      isActive: merged.isActive,
      customerRequired: merged.customerRequired,
      customerGeoType: merged.customerRequired ? merged.customerGeoType : null,
      dealerRequired: merged.dealerRequired,
      dealerGeoType: merged.dealerRequired ? merged.dealerGeoType : null,
      sameLicenceForBothAudiences: merged.sameLicenceForBothAudiences,
      version: current.version + 1,
      previousVersionId: current.id,
      changeReason: reason,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: "LICENCE_REQUIREMENT_REVISED",
    entityType: "LicenceRequirement",
    entityId: next.id,
    metadata: { previousVersionId: current.id, before: current, after: merged },
    reason,
  });
  await reconcileTaxonomyNodeCompliance(
    current.taxonomyNodeType,
    current.taxonomyNodeId,
    "REQUIREMENT_CHANGED",
    next.id,
  );

  return { ok: true, requirementId: next.id };
}

/**
 * Admin-only, hard delete of a LicenceRequirement — permitted once its
 * current (latest) version is already inactive (deactivate first; spec:
 * "with deactivate ... an option to delete the record ... altogether"),
 * and only when zero SellerLicenceSubmission rows were ever recorded
 * against ANY version in its revision chain.
 *
 * This must delete the WHOLE chain (this version + every ancestor reached
 * by walking previousVersionId), not just the row passed in. Deleting only
 * the latest version was the original (buggy) behavior: previousVersionId
 * is a real FK (ON DELETE SET NULL), so removing v2 just detaches it —
 * v1 keeps existing, and since v1's own `isActive` was never touched by
 * the revision that superseded it (reviseLicenceRequirement never mutates
 * the row it supersedes), v1 silently reappeared as the "current" direct
 * requirement (nextVersion now null again) and was still `isActive: true`
 * — undeletable, looking exactly like the delete had silently failed or
 * been undone. Deleting the full chain in one go removes the requirement
 * for good, with nothing left to resurface.
 *
 * The submission check spans every id in the chain for the same reason —
 * the FK (SellerLicenceSubmission.requirementId) is ON DELETE RESTRICT on
 * purpose, since a submission's requirementId is real compliance evidence
 * of exactly which version it was approved/rejected under; this refuses
 * the whole delete with a clear message rather than ever attempting an
 * unsafe cascade over real submission history.
 */
export async function deleteLicenceRequirement(
  id: string,
  actor: { id: string },
): Promise<LicenceRequirementResult> {
  const target = await prisma.licenceRequirement.findUnique({
    where: { id },
    select: { id: true, name: true, isActive: true, taxonomyNodeType: true, taxonomyNodeId: true },
  });
  if (!target) return { ok: false, error: "Licence requirement not found." };
  if (target.isActive)
    return { ok: false, error: "Deactivate this requirement before deleting it." };

  const chainIds = [target.id];
  let cursor = await prisma.licenceRequirement.findUnique({
    where: { id: target.id },
    select: { previousVersionId: true },
  });
  while (cursor?.previousVersionId) {
    chainIds.push(cursor.previousVersionId);
    cursor = await prisma.licenceRequirement.findUnique({
      where: { id: cursor.previousVersionId },
      select: { previousVersionId: true },
    });
  }

  const submissionCount = await prisma.sellerLicenceSubmission.count({
    where: { requirementId: { in: chainIds } },
  });
  if (submissionCount > 0) {
    return {
      ok: false,
      error: `This licence has ${submissionCount} seller submission${submissionCount === 1 ? "" : "s"} on record against an earlier version and cannot be deleted — it is already deactivated and no longer in effect, but its submission history must be preserved.`,
    };
  }

  await prisma.licenceRequirement.deleteMany({ where: { id: { in: chainIds } } });

  await writeAuditLog({
    actorId: actor.id,
    actorRole: "ADMIN",
    action: "LICENCE_REQUIREMENT_DELETED",
    entityType: "LicenceRequirement",
    entityId: id,
    metadata: {
      name: target.name,
      taxonomyNodeType: target.taxonomyNodeType,
      taxonomyNodeId: target.taxonomyNodeId,
      deletedVersionIds: chainIds,
    },
  });

  return { ok: true, requirementId: id };
}
