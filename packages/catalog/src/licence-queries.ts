import { prisma } from "@kisan4u/db";
import type { TaxonomyNodeType, LicenceStatus, SellerLicenceAudience } from "@kisan4u/db";

const EXPIRING_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const SUBMISSION_INCLUDE = {
  requirement: {
    select: {
      id: true,
      name: true,
      taxonomyNodeType: true,
      taxonomyNodeId: true,
      customerGeoType: true,
      dealerGeoType: true,
    },
  },
  customerStates: { select: { id: true, name: true } },
  dealerStates: { select: { id: true, name: true } },
  seller: {
    select: {
      id: true,
      shopName: true,
      user: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  },
  previousRevision: { select: { id: true, status: true, submittedAt: true } },
  nextRevision: { select: { id: true } },
} as const;

export type SellerLicenceSubmissionRow = Awaited<
  ReturnType<typeof getSellerLicenceSubmissions>
>[number];

/** Every submission (all revisions) for one seller, newest first — used for both the seller's own table and the revision-history view. */
export async function getSellerLicenceSubmissions(sellerId: string) {
  const rows = await prisma.sellerLicenceSubmission.findMany({
    where: { sellerId },
    include: SUBMISSION_INCLUDE,
    orderBy: { submittedAt: "desc" },
  });
  return rows;
}

/** Only the current (non-superseded) revision per chain — what the summary cards and default table view should count/show. */
export async function getSellerCurrentLicenceSubmissions(sellerId: string) {
  const rows = await prisma.sellerLicenceSubmission.findMany({
    where: { sellerId, nextRevision: { is: null } },
    include: SUBMISSION_INCLUDE,
    orderBy: { submittedAt: "desc" },
  });
  return rows;
}

export async function getLicenceSubmissionById(id: string) {
  return prisma.sellerLicenceSubmission.findUnique({ where: { id }, include: SUBMISSION_INCLUDE });
}

async function resolveTaxonomyPathLabel(
  nodeType: TaxonomyNodeType,
  nodeId: string,
): Promise<string> {
  if (nodeType === "CATEGORY") {
    const c = await prisma.category.findUnique({ where: { id: nodeId }, select: { name: true } });
    return c?.name ?? "—";
  }
  if (nodeType === "SUBCATEGORY") {
    const s = await prisma.subcategory.findUnique({
      where: { id: nodeId },
      select: { name: true, category: { select: { name: true } } },
    });
    return s ? `${s.category.name} → ${s.name}` : "—";
  }
  const x = await prisma.subSubCategory.findUnique({
    where: { id: nodeId },
    select: {
      name: true,
      subCategory: { select: { name: true, category: { select: { name: true } } } },
    },
  });
  return x ? `${x.subCategory.category.name} → ${x.subCategory.name} → ${x.name}` : "—";
}

export async function getTaxonomyPathLabelsForSubmissions(
  rows: { requirement: { taxonomyNodeType: TaxonomyNodeType; taxonomyNodeId: string } }[],
): Promise<Map<string, string>> {
  const uniqueKeys = new Map<string, { type: TaxonomyNodeType; id: string }>();
  for (const r of rows) {
    const key = `${r.requirement.taxonomyNodeType}:${r.requirement.taxonomyNodeId}`;
    uniqueKeys.set(key, { type: r.requirement.taxonomyNodeType, id: r.requirement.taxonomyNodeId });
  }
  const labels = new Map<string, string>();
  for (const [key, { type, id }] of uniqueKeys) {
    labels.set(key, await resolveTaxonomyPathLabel(type, id));
  }
  return labels;
}

/** Active requirements directly on or inherited by a given node — the pool the "Add New Licence" form's step 3 picks from. */
export async function getActiveRequirementsForTaxonomyNode(
  nodeType: TaxonomyNodeType,
  nodeId: string,
) {
  const nodes: {
    type: TaxonomyNodeType;
    id: string;
    source: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
  }[] = [];
  if (nodeType === "CATEGORY") {
    nodes.push({ type: "CATEGORY", id: nodeId, source: "CATEGORY" });
  } else if (nodeType === "SUBCATEGORY") {
    const sub = await prisma.subcategory.findUnique({
      where: { id: nodeId },
      select: { categoryId: true },
    });
    if (sub) nodes.push({ type: "CATEGORY", id: sub.categoryId, source: "CATEGORY" });
    nodes.push({ type: "SUBCATEGORY", id: nodeId, source: "SUBCATEGORY" });
  } else {
    const x = await prisma.subSubCategory.findUnique({
      where: { id: nodeId },
      select: { subCategoryId: true, subCategory: { select: { categoryId: true } } },
    });
    if (x) {
      nodes.push({ type: "CATEGORY", id: x.subCategory.categoryId, source: "CATEGORY" });
      nodes.push({ type: "SUBCATEGORY", id: x.subCategoryId, source: "SUBCATEGORY" });
    }
    nodes.push({ type: "SUBSUBCATEGORY", id: nodeId, source: "SUBSUBCATEGORY" });
  }

  const results: {
    requirement: Awaited<ReturnType<typeof prisma.licenceRequirement.findMany>>[number];
    source: "CATEGORY" | "SUBCATEGORY" | "SUBSUBCATEGORY";
  }[] = [];
  for (const node of nodes) {
    const requirements = await prisma.licenceRequirement.findMany({
      where: {
        taxonomyNodeType: node.type,
        taxonomyNodeId: node.id,
        isActive: true,
        nextVersion: { is: null },
      },
    });
    results.push(...requirements.map((requirement) => ({ requirement, source: node.source })));
  }
  return results;
}

export type AdminLicenceSubmissionFilters = {
  search?: string;
  status?: LicenceStatus;
  audience?: SellerLicenceAudience;
  sellerId?: string;
  page?: number;
  pageSize?: number;
};

export async function getAdminLicenceSubmissions(filters: AdminLicenceSubmissionFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  const where = {
    nextRevision: { is: null },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.audience ? { audience: filters.audience } : {}),
    ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
    ...(filters.search
      ? {
          OR: [
            { licenceNumber: { contains: filters.search, mode: "insensitive" as const } },
            { requirement: { name: { contains: filters.search, mode: "insensitive" as const } } },
            { seller: { shopName: { contains: filters.search, mode: "insensitive" as const } } },
            {
              seller: {
                user: { firstName: { contains: filters.search, mode: "insensitive" as const } },
              },
            },
            {
              seller: {
                user: { lastName: { contains: filters.search, mode: "insensitive" as const } },
              },
            },
            {
              seller: {
                user: { email: { contains: filters.search, mode: "insensitive" as const } },
              },
            },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sellerLicenceSubmission.findMany({
      where,
      include: SUBMISSION_INCLUDE,
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerLicenceSubmission.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export type AdminLicenceKpis = {
  totalSellers: number;
  totalLicences: number;
  pendingApproval: number;
  approved: number;
  rejected: number;
  expiringSoon: number;
};

/**
 * Global dashboard numbers for the admin Seller Licences page's stat-card
 * row — every current-revision submission across every seller, always
 * (deliberately independent of whatever the seller-list search/filters
 * below are set to, same as any other summary-card row in this app).
 */
export async function getAdminLicenceKpis(): Promise<AdminLicenceKpis> {
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_SOON_WINDOW_MS);

  const [distinctSellers, statusCounts, expiringSoon] = await Promise.all([
    prisma.sellerLicenceSubmission.findMany({
      where: { nextRevision: { is: null } },
      select: { sellerId: true },
      distinct: ["sellerId"],
    }),
    prisma.sellerLicenceSubmission.groupBy({
      by: ["status"],
      where: { nextRevision: { is: null } },
      _count: true,
    }),
    prisma.sellerLicenceSubmission.count({
      where: {
        nextRevision: { is: null },
        status: "APPROVED",
        expiryDate: { gte: now, lte: soon },
      },
    }),
  ]);

  const countFor = (status: LicenceStatus) =>
    statusCounts.find((s) => s.status === status)?._count ?? 0;

  return {
    totalSellers: distinctSellers.length,
    totalLicences: statusCounts.reduce((sum, s) => sum + s._count, 0),
    pendingApproval: countFor("PENDING_APPROVAL"),
    approved: countFor("APPROVED"),
    rejected: countFor("REJECTED"),
    expiringSoon,
  };
}

export type AdminLicenceSellerSummaryFilters = {
  search?: string;
  status?: LicenceStatus;
  audience?: SellerLicenceAudience;
  requirementId?: string;
  /** "Which geography does this licence's audience-relevant coverage read from" — see the identical rule in actions.ts's per-row coverage label. Dealer-only submissions read dealerGeoType; CUSTOMER or BOTH read customerGeoType. */
  coverage?: "PAN_INDIA" | "STATE_WISE";
  page?: number;
  pageSize?: number;
};

export type AdminLicenceSellerSummary = {
  sellerId: string;
  shopName: string;
  contactEmail: string | null;
  joinedAt: Date;
  totalLicences: number;
  pending: number;
  approved: number;
  rejected: number;
  expiringSoon: number;
  lastUpdated: Date | null;
};

/**
 * One row per seller for the admin Seller Licences page's grouped table —
 * `page`/`pageSize` paginate SELLERS, not individual licence submissions
 * (see getSellerCurrentLicenceSubmissions for the licences themselves,
 * fetched separately per seller only when that seller's row is expanded,
 * so this page's initial load never has to pull every licence for every
 * seller on the page).
 *
 * Every per-seller count (total/pending/approved/rejected/expiringSoon)
 * reflects that seller's TRUE full state across ALL their current-revision
 * submissions, regardless of `status`/`audience`/`requirementId`/
 * `coverage` — those filters only decide which sellers appear in the list
 * at all (a seller needs at least one current submission matching every
 * active filter to show up), the same "filter narrows the list, counts
 * stay real" behavior as the KPI cards above.
 */
export async function getAdminLicenceSellerSummaries(
  filters: AdminLicenceSellerSummaryFilters,
): Promise<{
  sellers: AdminLicenceSellerSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 10;

  const coveragePredicate = filters.coverage
    ? {
        OR: [
          { audience: "DEALER" as const, dealerGeoType: filters.coverage },
          {
            audience: { in: ["CUSTOMER", "BOTH"] as SellerLicenceAudience[] },
            customerGeoType: filters.coverage,
          },
        ],
      }
    : {};

  const matchingSubmission = {
    nextRevision: { is: null },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.audience ? { audience: filters.audience } : {}),
    ...(filters.requirementId ? { requirementId: filters.requirementId } : {}),
    ...coveragePredicate,
  };

  const sellerWhere = {
    licenceSubmissions: { some: matchingSubmission },
    ...(filters.search
      ? {
          OR: [
            { shopName: { contains: filters.search, mode: "insensitive" as const } },
            { user: { email: { contains: filters.search, mode: "insensitive" as const } } },
            {
              licenceSubmissions: {
                some: {
                  ...matchingSubmission,
                  licenceNumber: { contains: filters.search, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [sellers, total] = await Promise.all([
    prisma.sellerProfile.findMany({
      where: sellerWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        shopName: true,
        createdAt: true,
        user: { select: { email: true } },
        // Unfiltered by status/audience/requirementId/coverage on purpose
        // — this is what makes the per-seller counts below the seller's
        // real state rather than just "how many matched the filter."
        licenceSubmissions: {
          where: { nextRevision: { is: null } },
          select: { status: true, expiryDate: true, updatedAt: true },
        },
      },
    }),
    prisma.sellerProfile.count({ where: sellerWhere }),
  ]);

  const nowMs = Date.now();
  const soonMs = nowMs + EXPIRING_SOON_WINDOW_MS;

  const summaries: AdminLicenceSellerSummary[] = sellers.map((s) => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let expiringSoon = 0;
    let lastUpdated: Date | null = null;
    for (const sub of s.licenceSubmissions) {
      if (sub.status === "PENDING_APPROVAL") pending++;
      else if (sub.status === "APPROVED") {
        approved++;
        const t = sub.expiryDate.getTime();
        if (t >= nowMs && t <= soonMs) expiringSoon++;
      } else if (sub.status === "REJECTED") rejected++;
      if (!lastUpdated || sub.updatedAt > lastUpdated) lastUpdated = sub.updatedAt;
    }
    return {
      sellerId: s.id,
      shopName: s.shopName,
      contactEmail: s.user.email,
      joinedAt: s.createdAt,
      totalLicences: s.licenceSubmissions.length,
      pending,
      approved,
      rejected,
      expiringSoon,
      lastUpdated,
    };
  });

  return { sellers: summaries, total, page, pageSize };
}
