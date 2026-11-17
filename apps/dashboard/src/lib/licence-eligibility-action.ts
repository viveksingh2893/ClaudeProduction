"use server";

import {
  evaluateSellingLicenceEligibility,
  type SellingLicenceEligibilityResult,
} from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { requireSession } from "./session-guard";

export type LicenceEligibilityActionResult =
  { ok: true; data: SellingLicenceEligibilityResult } | { ok: false; error: string };

/**
 * Shared by the seller and admin product forms (both render the same
 * ProductForm component) — purely for UX (fading taxonomy options,
 * "Select wherever applicable", the eligibility summary). The actual
 * enforcement happens server-side at save/submit/approve time regardless
 * (see packages/catalog/src/product-submission.ts) — this action's result
 * is never trusted as the final word, only used to guide the form.
 *
 * A SELLER may only query their own sellerId; an ADMIN may query any.
 */
export async function getProductLicenceEligibilityAction(
  sellerId: string,
  taxonomyPath: {
    categoryId: string;
    subCategoryId?: string | null;
    subSubCategoryId?: string | null;
  },
): Promise<LicenceEligibilityActionResult> {
  const session = await requireSession(["ADMIN", "SELLER"]);
  if (session.user.role === "SELLER") {
    const profile = await prisma.sellerProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!profile || profile.id !== sellerId) return { ok: false, error: "Not authorized." };
  }
  if (!taxonomyPath.categoryId) return { ok: false, error: "Select a category first." };

  const data = await evaluateSellingLicenceEligibility(sellerId, taxonomyPath);
  return { ok: true, data };
}
