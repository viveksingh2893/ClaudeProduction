import { prisma } from "@kisan4u/db";
import type { TaxonomyNodeType, LicenceGeoType, SellerLicenceAudience } from "@kisan4u/db";

/**
 * THE single authoritative licence-eligibility calculation for the whole
 * app — spec requirement "Use a central server-side licence eligibility
 * service. Do not duplicate licensing calculations in multiple pages."
 * Every caller (product form, product create/update API, product
 * submission/approval, cart/checkout, catalogues, "Select wherever
 * applicable") goes through either buildSellerLicenceEligibilityIndex +
 * evaluateEligibilityForPath, or one of the thin wrappers at the bottom of
 * this file — never re-implements the AND-across-requirements /
 * inheritance / expiry logic itself.
 *
 * Split into two phases on purpose:
 *   1. buildSellerLicenceEligibilityIndex(sellerId) — the only part that
 *      touches the database. Fetches every active requirement and every
 *      one of the seller's current (non-superseded) submissions ONCE,
 *      indexed by taxonomy node / requirement id.
 *   2. evaluateEligibilityForPath(index, taxonomyPath) — a pure function,
 *      no I/O. Combines category + subcategory + sub-subcategory
 *      requirements for one path using the shared index.
 * This lets a caller that needs to fade/label many taxonomy options at
 * once (the seller product form's category/subcategory/sub-subcategory
 * pickers) build the index once and evaluate every option against it
 * in-memory, instead of one DB round trip per option.
 */

export type RequirementLegStatus =
  | "NOT_APPLICABLE"
  | "MISSING"
  | "PENDING_APPROVAL"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED"
  | "APPROVED";

export type RequirementLegEligibility = {
  required: boolean;
  geoType: LicenceGeoType | null;
  status: RequirementLegStatus;
  submissionId: string | null;
  reason: string | null;
  /** null = every state (Pan India, or not applicable/not approved); concrete list only when APPROVED + STATE_WISE. */
  coveredStateIds: string[] | null;
};

export type RequirementEligibility = {
  requirementId: string;
  name: string;
  source: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
  sameLicenceForBothAudiences: boolean;
  customer: RequirementLegEligibility;
  dealer: RequirementLegEligibility;
};

export type AudienceEligibility = {
  /** Concrete, expanded — [] means blocked in every state; equals every currently-active IndianState id when isPanIndia. */
  eligibleStateIds: string[];
  isPanIndia: boolean;
  /** Requirements that are NOT satisfied at all for this audience (missing/pending/rejected/expired/revoked) — these are what drive eligibleStateIds to [], not a partial-state requirement. */
  blockingRequirements: { requirementId: string; name: string; status: RequirementLegStatus }[];
};

export type SellingLicenceEligibilityResult = {
  taxonomyPath: {
    categoryId: string;
    subCategoryId: string | null;
    subSubCategoryId: string | null;
  };
  requirements: RequirementEligibility[];
  customer: AudienceEligibility;
  dealer: AudienceEligibility;
};

type IndexedRequirement = {
  id: string;
  taxonomyNodeType: TaxonomyNodeType;
  taxonomyNodeId: string;
  name: string;
  customerRequired: boolean;
  customerGeoType: LicenceGeoType | null;
  dealerRequired: boolean;
  dealerGeoType: LicenceGeoType | null;
  sameLicenceForBothAudiences: boolean;
};

type IndexedSubmission = {
  id: string;
  requirementId: string;
  audience: SellerLicenceAudience;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
  expiryDate: Date;
  rejectionReason: string | null;
  revocationReason: string | null;
  customerStateIds: string[];
  dealerStateIds: string[];
};

export type SellerLicenceEligibilityIndex = {
  sellerId: string;
  requirementsByNode: Map<string, IndexedRequirement[]>; // key: `${type}:${id}`
  submissionsByRequirement: Map<string, IndexedSubmission[]>; // key: requirementId — 0, 1 (single-audience), or 2 (customer+dealer separate) current submissions
  activeStateIds: string[];
};

function nodeKey(type: TaxonomyNodeType, id: string): string {
  return `${type}:${id}`;
}

/**
 * Fetches everything needed to evaluate eligibility for this seller
 * against ANY taxonomy path, in a fixed small number of queries
 * regardless of how many paths get evaluated against the result.
 */
export async function buildSellerLicenceEligibilityIndex(
  sellerId: string,
): Promise<SellerLicenceEligibilityIndex> {
  const [requirements, activeStates] = await Promise.all([
    prisma.licenceRequirement.findMany({
      where: { isActive: true },
      select: {
        id: true,
        taxonomyNodeType: true,
        taxonomyNodeId: true,
        name: true,
        customerRequired: true,
        customerGeoType: true,
        dealerRequired: true,
        dealerGeoType: true,
        sameLicenceForBothAudiences: true,
      },
    }),
    prisma.indianState.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);

  const requirementsByNode = new Map<string, IndexedRequirement[]>();
  for (const r of requirements) {
    const key = nodeKey(r.taxonomyNodeType, r.taxonomyNodeId);
    const list = requirementsByNode.get(key) ?? [];
    list.push(r);
    requirementsByNode.set(key, list);
  }

  const requirementIds = requirements.map((r) => r.id);
  const submissionsByRequirement = new Map<string, IndexedSubmission[]>();
  if (requirementIds.length > 0) {
    const rows = await prisma.sellerLicenceSubmission.findMany({
      where: { sellerId, requirementId: { in: requirementIds }, nextRevision: { is: null } },
      select: {
        id: true,
        requirementId: true,
        audience: true,
        status: true,
        expiryDate: true,
        rejectionReason: true,
        revocationReason: true,
        customerStates: { select: { id: true } },
        dealerStates: { select: { id: true } },
      },
    });
    const now = new Date();
    for (const row of rows) {
      const list = submissionsByRequirement.get(row.requirementId) ?? [];
      list.push({
        id: row.id,
        requirementId: row.requirementId,
        audience: row.audience,
        // Expiry is enforced HERE, at read time, regardless of stored
        // status — never trust a stale APPROVED row past its expiry date
        // (spec §3/§10: "Expiry must work even if a scheduled job is
        // delayed").
        status: row.status === "APPROVED" && row.expiryDate <= now ? "EXPIRED" : row.status,
        expiryDate: row.expiryDate,
        rejectionReason: row.rejectionReason,
        revocationReason: row.revocationReason,
        customerStateIds: row.customerStates.map((s) => s.id),
        dealerStateIds: row.dealerStates.map((s) => s.id),
      });
      submissionsByRequirement.set(row.requirementId, list);
    }
  }

  return {
    sellerId,
    requirementsByNode,
    submissionsByRequirement,
    activeStateIds: activeStates.map((s) => s.id),
  };
}

function resolveLeg(
  requirementId: string,
  required: boolean,
  geoType: LicenceGeoType | null,
  audience: "CUSTOMER" | "DEALER",
  sameLicenceForBothAudiences: boolean,
  index: SellerLicenceEligibilityIndex,
): RequirementLegEligibility {
  if (!required)
    return {
      required: false,
      geoType: null,
      status: "NOT_APPLICABLE",
      submissionId: null,
      reason: null,
      coveredStateIds: null,
    };

  const submissions = index.submissionsByRequirement.get(requirementId) ?? [];
  const matches = sameLicenceForBothAudiences
    ? submissions.filter((s) => s.audience === "BOTH")
    : submissions.filter((s) => s.audience === audience);

  if (matches.length === 0)
    return {
      required: true,
      geoType,
      status: "MISSING",
      submissionId: null,
      reason: null,
      coveredStateIds: null,
    };

  // A state-wise requirement covers exactly one state PER submission by
  // design (insertSubmission: "if a seller has the same licence for
  // multiple states, they must create a separate licence submission for
  // each state") — so a seller with several states approved has several
  // concurrent current submissions for this same requirement+audience.
  // Union every APPROVED one's coverage rather than picking an arbitrary
  // single row, which previously left all but one approved state
  // unrecognized (see licence-eligibility bug: only the first submission
  // .find() happened to return counted toward eligibility).
  const approved = matches.filter((s) => s.status === "APPROVED");
  if (approved.length > 0) {
    const stateIds =
      audience === "CUSTOMER"
        ? [...new Set(approved.flatMap((s) => s.customerStateIds))]
        : [...new Set(approved.flatMap((s) => s.dealerStateIds))];
    return {
      required: true,
      geoType,
      status: "APPROVED",
      submissionId: approved[approved.length - 1]!.id,
      reason: null,
      coveredStateIds: geoType === "PAN_INDIA" ? null : stateIds,
    };
  }

  // No approved submission for this requirement+audience — report the
  // most recent non-approved one so the seller/admin sees a concrete
  // status and reason (still blocking, same as before this only ever
  // considered one submission).
  const fallback = matches[matches.length - 1]!;
  return {
    required: true,
    geoType,
    status: fallback.status,
    submissionId: fallback.id,
    reason: fallback.rejectionReason ?? fallback.revocationReason ?? null,
    coveredStateIds: null,
  };
}

function combineAudience(
  requirements: RequirementEligibility[],
  audience: "customer" | "dealer",
  activeStateIds: string[],
): AudienceEligibility {
  const legs = requirements
    .map((r) => ({
      requirementId: r.requirementId,
      name: r.name,
      leg: audience === "customer" ? r.customer : r.dealer,
    }))
    .filter((x) => x.leg.required);

  const blocking = legs
    .filter((x) => x.leg.status !== "APPROVED")
    .map((x) => ({ requirementId: x.requirementId, name: x.name, status: x.leg.status }));
  if (blocking.length > 0) {
    return { eligibleStateIds: [], isPanIndia: false, blockingRequirements: blocking };
  }

  // Every applicable requirement is APPROVED — intersect their coverage.
  // coveredStateIds === null means Pan India (universal set) for that leg.
  let intersection: Set<string> | null = null; // null = still universal
  for (const x of legs) {
    if (x.leg.coveredStateIds === null) continue; // Pan India — doesn't narrow the intersection
    const legSet = new Set(x.leg.coveredStateIds);
    if (intersection === null) {
      intersection = legSet;
    } else {
      const narrowed: Set<string> = intersection;
      intersection = new Set([...narrowed].filter((id) => legSet.has(id)));
    }
  }

  if (intersection === null) {
    return { eligibleStateIds: [...activeStateIds], isPanIndia: true, blockingRequirements: [] };
  }
  return { eligibleStateIds: [...intersection], isPanIndia: false, blockingRequirements: [] };
}

/** Pure, no I/O — combine category + subcategory + sub-subcategory requirements from a pre-built index for one taxonomy path. */
export function evaluateEligibilityForPath(
  index: SellerLicenceEligibilityIndex,
  taxonomyPath: {
    categoryId: string;
    subCategoryId?: string | null;
    subSubCategoryId?: string | null;
  },
): SellingLicenceEligibilityResult {
  const nodes: {
    type: TaxonomyNodeType;
    id: string;
    source: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
  }[] = [{ type: "CATEGORY", id: taxonomyPath.categoryId, source: "CATEGORY" }];
  if (taxonomyPath.subCategoryId)
    nodes.push({ type: "SUBCATEGORY", id: taxonomyPath.subCategoryId, source: "SUBCATEGORY" });
  if (taxonomyPath.subSubCategoryId)
    nodes.push({
      type: "SUBSUBCATEGORY",
      id: taxonomyPath.subSubCategoryId,
      source: "SUBSUBCATEGORY",
    });

  // Dedup by requirement id — "If the same requirement ID is encountered
  // more than once, evaluate it once" (can't actually happen across
  // distinct taxonomy nodes today, but is cheap to guard regardless).
  const seen = new Set<string>();
  const requirements: RequirementEligibility[] = [];
  for (const node of nodes) {
    const nodeRequirements = index.requirementsByNode.get(nodeKey(node.type, node.id)) ?? [];
    for (const r of nodeRequirements) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      requirements.push({
        requirementId: r.id,
        name: r.name,
        source: node.source,
        sameLicenceForBothAudiences: r.sameLicenceForBothAudiences,
        customer: resolveLeg(
          r.id,
          r.customerRequired,
          r.customerGeoType,
          "CUSTOMER",
          r.sameLicenceForBothAudiences,
          index,
        ),
        dealer: resolveLeg(
          r.id,
          r.dealerRequired,
          r.dealerGeoType,
          "DEALER",
          r.sameLicenceForBothAudiences,
          index,
        ),
      });
    }
  }

  return {
    taxonomyPath: {
      categoryId: taxonomyPath.categoryId,
      subCategoryId: taxonomyPath.subCategoryId ?? null,
      subSubCategoryId: taxonomyPath.subSubCategoryId ?? null,
    },
    requirements,
    customer: combineAudience(requirements, "customer", index.activeStateIds),
    dealer: combineAudience(requirements, "dealer", index.activeStateIds),
  };
}

/** Convenience one-shot wrapper for a single ad-hoc check (e.g. server-side revalidation of one already-known product path) — builds a throwaway index just for this call. Prefer buildSellerLicenceEligibilityIndex + evaluateEligibilityForPath directly when evaluating many paths for the same seller (product form, catalogue listing). */
export async function evaluateSellingLicenceEligibility(
  sellerId: string,
  taxonomyPath: {
    categoryId: string;
    subCategoryId?: string | null;
    subSubCategoryId?: string | null;
  },
): Promise<SellingLicenceEligibilityResult> {
  const index = await buildSellerLicenceEligibilityIndex(sellerId);
  return evaluateEligibilityForPath(index, taxonomyPath);
}

/**
 * "When the seller clicks an ineligible state, show a specific red error
 * ... If multiple licences are missing, list all blocking licences." A
 * state can be blocked either because some requirement is unsatisfied
 * everywhere (blockingRequirements) or because a satisfied,
 * STATE_WISE-approved requirement simply doesn't cover that particular
 * state — this walks both cases and returns one human-readable line per
 * cause.
 */
export function explainBlockedState(
  result: SellingLicenceEligibilityResult,
  audience: "customer" | "dealer",
  stateId: string,
): string[] {
  const reasons: string[] = [];
  const audienceResult = audience === "customer" ? result.customer : result.dealer;
  for (const b of audienceResult.blockingRequirements) {
    reasons.push(`"${b.name}" is ${legStatusLabel(b.status)}.`);
  }
  if (audienceResult.blockingRequirements.length === 0) {
    for (const r of result.requirements) {
      const leg = audience === "customer" ? r.customer : r.dealer;
      if (
        leg.required &&
        leg.status === "APPROVED" &&
        leg.coveredStateIds !== null &&
        !leg.coveredStateIds.includes(stateId)
      ) {
        reasons.push(`"${r.name}" is not approved for this state.`);
      }
    }
  }
  return reasons;
}

export function legStatusLabel(status: RequirementLegStatus): string {
  switch (status) {
    case "MISSING":
      return "not submitted";
    case "PENDING_APPROVAL":
      return "pending approval";
    case "REJECTED":
      return "rejected";
    case "EXPIRED":
      return "expired";
    case "REVOKED":
      return "revoked";
    case "APPROVED":
      return "approved";
    case "NOT_APPLICABLE":
      return "not applicable";
  }
}
