import type { FieldMatch, Confidence } from "./matching";

export type EntityType = "CUSTOMER" | "DEALER" | "SELLER" | "PRODUCT" | "VARIANT";

export type DependentCount = { table: string; count: number };

/**
 * One reason a candidate is blocked from automatic deletion — always
 * human-readable, always attached to the specific record it applies to.
 * A candidate with ANY block reason is never included in the deletion
 * manifest, regardless of confidence.
 */
export type BlockReason = string;

export type Candidate = {
  entityType: EntityType;
  id: string;
  /** Display name — firstName+lastName for a user, shopName for a seller, product/variant name. */
  name: string;
  email: string | null;
  role: string | null;
  /** The seller/store name this record belongs to or owns — set for sellers themselves, and for products/variants (their owning seller), and for dealer product requests where relevant. */
  sellerLabel: string | null;
  matches: FieldMatch[];
  confidence: Confidence;
  createdAt: Date;
  dependents: DependentCount[];
  blockReasons: BlockReason[];
  /** True when this record has more than one populated role/profile relation (e.g. a User with both a SellerProfile and a DealerProfile) — always flagged for manual review, never auto-included even if otherwise a clean high-confidence match. */
  multiRole: boolean;
  /** True when a dependent record links this candidate to a counterpart that does NOT itself look like test data (e.g. a test customer's order placed with a real, non-test seller). */
  linkedToApparentlyRealData: boolean;
  linkedToApparentlyRealDataDetail: string | null;
  /** Product/variant-specific: the owning seller's own candidate status, when relevant. */
  ownerIsTestSeller?: boolean;
  /** Product-specific: the raw sellerId (SellerProfile.id), null for an in-house/admin product — used only for the seller<->product cross-blocking check, not displayed directly. */
  ownerSellerId?: string | null;
};

export function isDeletable(c: Candidate): boolean {
  return c.confidence === "HIGH" && !c.multiRole && c.blockReasons.length === 0;
}
