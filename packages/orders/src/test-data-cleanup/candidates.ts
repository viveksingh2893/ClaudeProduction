/**
 * Finds candidate test records. The `contains: "test", mode: "insensitive"`
 * filters below are a broad, over-inclusive DATABASE PREFILTER only — used
 * to avoid loading every row in a large table into memory. They are NEVER
 * the classification itself: every row that survives the prefilter is
 * re-checked in application code by matching.ts's tokenizer-based rules,
 * which correctly reject a prefilter false-positive like "Contest Winner"
 * (survives `ILIKE '%test%'`, but tokenizes to ["Contest","Winner"] — no
 * "test" token) before it can ever appear as a candidate.
 */
import { prisma, getFullName } from "@kisan4u/db";
import { matchField, matchEmailLocalPart, matchDescription, classifyConfidence, type FieldMatch } from "./matching";
import type { Candidate } from "./types";

const CI = { mode: "insensitive" as const };

function collectMatches(fields: [string, string | null | undefined][]): FieldMatch[] {
  const matches: FieldMatch[] = [];
  for (const [field, value] of fields) {
    const m = matchField(field, value);
    if (m) matches.push(m);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function findCustomerCandidates(): Promise<Candidate[]> {
  const users = await prisma.user.findMany({
    where: {
      role: "CUSTOMER",
      OR: [
        { firstName: { contains: "test", ...CI } },
        { lastName: { contains: "test", ...CI } },
        { email: { contains: "test", ...CI } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      dealerProfile: { select: { id: true } },
      sellerProfile: { select: { id: true } },
      baProfile: { select: { id: true } },
      adminProfile: { select: { id: true } },
      deliveryProfile: { select: { id: true } },
      staffProfile: { select: { id: true } },
    },
  });

  const out: Candidate[] = [];
  for (const u of users) {
    const matches = collectMatches([
      ["firstName", u.firstName],
      ["lastName", u.lastName],
      ["email", u.email],
    ]);
    const emailLocal = matchEmailLocalPart(u.email);
    if (emailLocal) matches.push(emailLocal);
    if (matches.length === 0) continue;

    const profileCount = [
      u.dealerProfile,
      u.sellerProfile,
      u.baProfile,
      u.adminProfile,
      u.deliveryProfile,
      u.staffProfile,
    ].filter(Boolean).length;

    out.push({
      entityType: "CUSTOMER",
      id: u.id,
      name: getFullName(u) ?? u.phone ?? "(no name)",
      email: u.email,
      role: u.role,
      sellerLabel: null,
      matches,
      confidence: classifyConfidence(matches),
      createdAt: u.createdAt,
      dependents: [],
      blockReasons: [],
      multiRole: profileCount > 0, // a CUSTOMER-role user should have NO profile relation at all — any is anomalous
      linkedToApparentlyRealData: false,
      linkedToApparentlyRealDataDetail: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dealers
// ---------------------------------------------------------------------------

export async function findDealerCandidates(): Promise<Candidate[]> {
  const users = await prisma.user.findMany({
    where: {
      role: "DEALER",
      OR: [
        { firstName: { contains: "test", ...CI } },
        { lastName: { contains: "test", ...CI } },
        { email: { contains: "test", ...CI } },
        { dealerProfile: { storeName: { contains: "test", ...CI } } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      dealerProfile: { select: { id: true, storeName: true, gstNumber: true } },
      sellerProfile: { select: { id: true } },
      baProfile: { select: { id: true } },
      adminProfile: { select: { id: true } },
      deliveryProfile: { select: { id: true } },
      staffProfile: { select: { id: true } },
    },
  });

  const out: Candidate[] = [];
  for (const u of users) {
    const matches = collectMatches([
      ["firstName", u.firstName],
      ["lastName", u.lastName],
      ["email", u.email],
      ["dealerProfile.storeName", u.dealerProfile?.storeName],
    ]);
    const emailLocal = matchEmailLocalPart(u.email);
    if (emailLocal) matches.push(emailLocal);
    if (matches.length === 0) continue;

    const otherProfileCount = [u.sellerProfile, u.baProfile, u.adminProfile, u.deliveryProfile, u.staffProfile].filter(
      Boolean,
    ).length;

    out.push({
      entityType: "DEALER",
      id: u.id,
      name: getFullName(u) ?? u.phone ?? "(no name)",
      email: u.email,
      role: u.role,
      sellerLabel: u.dealerProfile?.storeName ?? null,
      matches,
      confidence: classifyConfidence(matches),
      createdAt: u.createdAt,
      dependents: [],
      blockReasons: u.dealerProfile ? [] : ["DEALER-role user has no DealerProfile row — data integrity issue, needs manual review, not auto-deleted"],
      multiRole: otherProfileCount > 0,
      linkedToApparentlyRealData: false,
      linkedToApparentlyRealDataDetail: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sellers
// ---------------------------------------------------------------------------

export async function findSellerCandidates(): Promise<Candidate[]> {
  const users = await prisma.user.findMany({
    where: {
      role: "SELLER",
      OR: [
        { firstName: { contains: "test", ...CI } },
        { lastName: { contains: "test", ...CI } },
        { email: { contains: "test", ...CI } },
        { sellerProfile: { shopName: { contains: "test", ...CI } } },
        { sellerProfile: { slug: { contains: "test", ...CI } } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      sellerProfile: { select: { id: true, shopName: true, slug: true, gstNumber: true } },
      dealerProfile: { select: { id: true } },
      baProfile: { select: { id: true } },
      adminProfile: { select: { id: true } },
      deliveryProfile: { select: { id: true } },
      staffProfile: { select: { id: true } },
    },
  });

  const out: Candidate[] = [];
  for (const u of users) {
    const matches = collectMatches([
      ["firstName", u.firstName],
      ["lastName", u.lastName],
      ["email", u.email],
      ["sellerProfile.shopName", u.sellerProfile?.shopName],
      ["sellerProfile.slug", u.sellerProfile?.slug],
    ]);
    const emailLocal = matchEmailLocalPart(u.email);
    if (emailLocal) matches.push(emailLocal);
    if (matches.length === 0) continue;

    const otherProfileCount = [u.dealerProfile, u.baProfile, u.adminProfile, u.deliveryProfile, u.staffProfile].filter(
      Boolean,
    ).length;

    out.push({
      entityType: "SELLER",
      id: u.sellerProfile?.id ?? u.id, // SellerProfile.id is the id everything else references (Product.sellerId etc.)
      name: u.sellerProfile?.shopName ?? getFullName(u) ?? u.phone ?? "(no name)",
      email: u.email,
      role: u.role,
      sellerLabel: u.sellerProfile?.shopName ?? null,
      matches,
      confidence: classifyConfidence(matches),
      createdAt: u.createdAt,
      dependents: [],
      blockReasons: u.sellerProfile ? [] : ["SELLER-role user has no SellerProfile row — data integrity issue, needs manual review, not auto-deleted"],
      multiRole: otherProfileCount > 0,
      linkedToApparentlyRealData: false,
      linkedToApparentlyRealDataDetail: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Products (independently matched — regardless of seller) and Variants
// ---------------------------------------------------------------------------

export async function findProductCandidates(testSellerIds: Set<string>): Promise<Candidate[]> {
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: "test", ...CI } },
        { sku: { contains: "test", ...CI } },
        { slug: { contains: "test", ...CI } },
      ],
    },
    select: {
      id: true,
      name: true,
      sku: true,
      slug: true,
      description: true,
      shortDescription: true,
      sellerId: true,
      seller: { select: { id: true, shopName: true } },
      createdAt: true,
    },
  });

  const out: Candidate[] = [];
  for (const p of products) {
    const matches = collectMatches([
      ["name", p.name],
      ["sku", p.sku],
      ["slug", p.slug],
    ]);
    const descMatch = matchDescription("description", p.description) ?? matchDescription("shortDescription", p.shortDescription);
    if (descMatch) matches.push(descMatch);
    if (matches.length === 0) continue;

    out.push({
      entityType: "PRODUCT",
      id: p.id,
      name: p.name,
      email: null,
      role: null,
      sellerLabel: p.seller?.shopName ?? "(in-house / admin product, no seller)",
      matches,
      confidence: classifyConfidence(matches),
      createdAt: p.createdAt,
      dependents: [],
      blockReasons: [],
      multiRole: false,
      linkedToApparentlyRealData: false,
      linkedToApparentlyRealDataDetail: null,
      ownerIsTestSeller: p.sellerId != null && testSellerIds.has(p.sellerId),
      ownerSellerId: p.sellerId,
    });
  }
  return out;
}

/** Every product owned by a confirmed-test seller — not itself required to match "test" by name, since ownership alone is the qualifying signal here (spec §9: "include products and variants owned exclusively by that seller as proposed dependent test records"). */
export async function findProductsOwnedByTestSellers(testSellerIds: string[]): Promise<Candidate[]> {
  if (testSellerIds.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { sellerId: { in: testSellerIds } },
    select: {
      id: true,
      name: true,
      sku: true,
      slug: true,
      sellerId: true,
      seller: { select: { shopName: true } },
      createdAt: true,
    },
  });
  return products.map((p) => ({
    entityType: "PRODUCT" as const,
    id: p.id,
    name: p.name,
    email: null,
    role: null,
    sellerLabel: p.seller?.shopName ?? null,
    matches: [], // owned-by-test-seller, not itself name-matched — see reason surfaced separately in the report
    confidence: "HIGH" as const, // ownership by a confirmed test seller is itself a high-confidence signal for THIS product being test data
    createdAt: p.createdAt,
    dependents: [],
    blockReasons: [],
    multiRole: false,
    linkedToApparentlyRealData: false,
    linkedToApparentlyRealDataDetail: null,
    ownerIsTestSeller: true,
    ownerSellerId: p.sellerId,
  }));
}

export async function findVariantCandidates(): Promise<Candidate[]> {
  const variants = await prisma.productVariant.findMany({
    where: { sku: { contains: "test", ...CI } },
    select: {
      id: true,
      sku: true,
      productId: true,
      product: { select: { name: true, sellerId: true, seller: { select: { shopName: true } } } },
      createdAt: true,
    },
  });

  const out: Candidate[] = [];
  for (const v of variants) {
    const matches = collectMatches([["sku", v.sku]]);
    if (matches.length === 0) continue;
    out.push({
      entityType: "VARIANT",
      id: v.id,
      name: `${v.product.name} — ${v.sku}`,
      email: null,
      role: null,
      sellerLabel: v.product.seller?.shopName ?? null,
      matches,
      confidence: classifyConfidence(matches),
      createdAt: v.createdAt,
      dependents: [],
      blockReasons: [],
      multiRole: false,
      linkedToApparentlyRealData: false,
      linkedToApparentlyRealDataDetail: null,
    });
  }
  return out;
}

/** Every variant belonging to one of the given product ids — used to pull in a test product's own variants regardless of whether the variant's own SKU happens to match "test" too. */
export async function findVariantsOfProducts(productIds: string[]): Promise<Candidate[]> {
  if (productIds.length === 0) return [];
  const variants = await prisma.productVariant.findMany({
    where: { productId: { in: productIds } },
    select: {
      id: true,
      sku: true,
      productId: true,
      product: { select: { name: true } },
      createdAt: true,
    },
  });
  return variants.map((v) => ({
    entityType: "VARIANT" as const,
    id: v.id,
    name: `${v.product.name} — ${v.sku}`,
    email: null,
    role: null,
    sellerLabel: null,
    matches: [],
    confidence: "HIGH" as const,
    createdAt: v.createdAt,
    dependents: [],
    blockReasons: [],
    multiRole: false,
    linkedToApparentlyRealData: false,
    linkedToApparentlyRealDataDetail: null,
  }));
}
