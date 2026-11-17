import { ProductLifecycleStatus } from "@kisan4u/db";

export type ProductActor = "SELLER" | "ADMIN";

/**
 * The only allowed product lifecycle transitions, and who's allowed to
 * trigger each one. A seller can never reach APPROVED/REJECTED/SUSPENDED
 * directly — those are admin-only decisions — and an admin never needs
 * to push a product back to DRAFT (that's the seller editing their own
 * rejected submission). Both roles can deactivate an approved product
 * (seller pulling their own listing, or admin moderating), and — the
 * exact mirror of that — both can bring an INACTIVE (self- or
 * admin-deactivated) listing back to APPROVED. SUSPENDED is deliberately
 * NOT included here for SELLER: that status only exists as an admin
 * enforcement action (moderation), not a listing the seller ever put
 * themselves into, so only an admin can lift it — letting a seller
 * self-reactivate out of a suspension would defeat the point of having a
 * separate SUSPENDED status at all.
 *
 * APPROVED -> SUBMITTED (SELLER) is the odd one out — a seller never
 * clicks a "resubmit" button for this; it happens automatically as a
 * side effect of saving an edit to an already-live product (see
 * updateProductAction, apps/dashboard/src/app/seller/products/actions.ts)
 * so an edited-but-not-yet-re-reviewed product doesn't stay silently
 * live. Once SUBMITTED it's invisible to customers again exactly like
 * the first-ever approval flow, until an admin reviews the edit.
 */
const TRANSITIONS: Record<ProductLifecycleStatus, Partial<Record<ProductLifecycleStatus, ProductActor[]>>> = {
  DRAFT: {
    SUBMITTED: ["SELLER"],
  },
  SUBMITTED: {
    APPROVED: ["ADMIN"],
    REJECTED: ["ADMIN"],
  },
  REJECTED: {
    DRAFT: ["SELLER"],
    SUBMITTED: ["SELLER"],
  },
  APPROVED: {
    SUSPENDED: ["ADMIN"],
    INACTIVE: ["SELLER", "ADMIN"],
    SUBMITTED: ["SELLER"],
  },
  SUSPENDED: {
    APPROVED: ["ADMIN"],
  },
  INACTIVE: {
    APPROVED: ["SELLER", "ADMIN"],
  },
};

export function canTransition(
  from: ProductLifecycleStatus,
  to: ProductLifecycleStatus,
  actor: ProductActor,
): boolean {
  const allowedActors = TRANSITIONS[from]?.[to];
  return !!allowedActors && allowedActors.includes(actor);
}
