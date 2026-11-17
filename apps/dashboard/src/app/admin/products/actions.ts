"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@kisan4u/db";
import {
  productDecisionSchema,
  productSectionPlacementInputSchema,
  productCategoryPlacementInputSchema,
} from "@kisan4u/validators";
import {
  approveProduct,
  rejectProduct,
  suspendProduct,
  reactivateProduct,
  adminDeactivateProduct,
  deleteProduct,
  setProductSectionPlacement,
  setProductCategoryPlacement,
} from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";
import { revalidateStorefrontHomepage } from "@/lib/revalidate-storefront";

type Result = { ok: true } | { ok: false; error: string };

/** Product Card Design Spec §Admin Panel Controls ("Featured priority: Sort and feature products — controls listing order"). Affects AUTOMATIC-mode homepage discovery ranking, so pings the storefront cache the same way admin/homepage/actions.ts does. */
export async function setFeaturedPositionAction(
  productId: string,
  position: number | null,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  await prisma.product.update({ where: { id: productId }, data: { featuredPosition: position } });
  revalidatePath("/admin/products");
  await revalidateStorefrontHomepage();
  return { ok: true };
}

/**
 * The single admin product-decision entry point — requireSession(["ADMIN"])
 * re-verifies both role and that the caller's own session hasn't itself
 * been revoked, independent of which page rendered the button that called
 * this (same principle as apps/dashboard/src/app/admin/actions.ts for
 * dealer/seller decisions). The actual transition legality (e.g. a seller
 * could never reach this action, but also SUBMITTED->SUSPENDED isn't a
 * valid jump even for an admin) is checked in packages/catalog.
 */
export async function decideProductAction(input: {
  productId: string;
  action: "APPROVE" | "REJECT" | "SUSPEND" | "REACTIVATE" | "DEACTIVATE";
  reason?: string;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = productDecisionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };

  const { productId, action, reason } = parsed.data;
  switch (action) {
    case "APPROVE":
      return approveProduct(productId);
    case "REJECT":
      return rejectProduct(productId, reason ?? "Not specified");
    case "SUSPEND":
      return suspendProduct(productId);
    case "REACTIVATE":
      return reactivateProduct(productId);
    case "DEACTIVATE":
      return adminDeactivateProduct(productId);
  }
}

/**
 * Permanent, irreversible removal — distinct from decideProductAction's
 * lifecycle transitions since there's no resulting status. Blocked inside
 * deleteProduct itself if the product has order history.
 */
export async function deleteProductAction(productId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  const result = await deleteProduct(productId);
  if (!result.ok) return result;
  revalidatePath("/admin/products");
  await revalidateStorefrontHomepage();
  return { ok: true };
}

/**
 * Trending / Best Sellers / New Arrivals placement — see
 * packages/catalog/src/product-placement.ts for the reorder/eligibility
 * logic; this action is just auth + input validation + revalidation
 * around it. `position: null` means "Not displayed" (remove from the
 * section).
 */
export async function setProductPlacementAction(input: {
  productId: string;
  section: "TRENDING" | "BEST_SELLERS" | "NEW_ARRIVALS";
  position: number | null;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = productSectionPlacementInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };

  const result = await setProductSectionPlacement(
    parsed.data.section,
    parsed.data.productId,
    parsed.data.position,
  );
  if (!result.ok) return result;

  revalidatePath("/admin/products");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
  return { ok: true };
}

/** The product's 1-10 rank in the per-category homepage section for its OWN category (resolved server-side by setProductCategoryPlacement). `position: null` clears it. */
export async function setProductCategoryPlacementAction(input: {
  productId: string;
  position: number | null;
}): Promise<Result> {
  await requireSession(["ADMIN"]);
  const parsed = productCategoryPlacementInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };

  const result = await setProductCategoryPlacement(parsed.data.productId, parsed.data.position);
  if (!result.ok) return result;

  revalidatePath("/admin/products");
  revalidateTag("homepage");
  await revalidateStorefrontHomepage();
  return { ok: true };
}
