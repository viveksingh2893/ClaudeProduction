"use server";

import { prisma } from "@kisan4u/db";
import {
  productDraftSubmissionSchema,
  type ProductSubmissionRawInput,
} from "@kisan4u/validators";
import { saveProductDraft, submitProductForApproval } from "@kisan4u/catalog";
import { applyNetPayablePricing, assertStoredNetPayableWithinMrp } from "@kisan4u/orders";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true; productId: string } | { ok: false; error: string };
type SimpleResult = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

function isSafeClientId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

function uploadErrorMessage(error: "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "SIGNATURE_MISMATCH"): string {
  if (error === "FILE_TOO_LARGE") return "File is too large — the maximum size is 5MB.";
  if (error === "SIGNATURE_MISMATCH") return "This file doesn't look like a real image.";
  return "Unsupported file type — upload a JPEG, PNG, or WEBP image.";
}

/**
 * `sellerId` on every action below comes from the "Add Product" page's own
 * ?sellerId= query param — chosen by the admin from a dropdown of approved
 * sellers, then bound into these actions via .bind(null, sellerId) (same
 * pattern as adminUpdateProductAction.bind(null, product.id) on the edit
 * page). Since it's a plain server-action argument rather than something
 * looked up from an existing row, a hand-crafted request could tamper with
 * it — closed off here by re-verifying it's a real APPROVED seller on every
 * call, same discipline as every other seller-scoped write in this app.
 */
async function assertApprovedSeller(sellerId: string): Promise<SimpleResult> {
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { status: true },
  });
  if (!seller) return { ok: false, error: "Seller not found." };
  if (seller.status !== "APPROVED") return { ok: false, error: "Seller is not approved." };
  return { ok: true };
}

/**
 * Admin creating a brand-new product on a chosen seller's behalf — the
 * counterpart to seller/products/actions.ts's createProductAction, routed
 * through the exact same lenient draft path (saveProductDraft with
 * mode: "CREATE") so a still-incomplete draft never blocks on it. Runs as
 * `asAdmin: false` deliberately, same as the existing admin bulk-product
 * CREATE path (packages/catalog/src/bulk-product-submission.ts) — an
 * admin-created product is otherwise a completely ordinary product owned
 * by the chosen seller (private brands/manufacturers stay off-limits,
 * merchandising fields aren't set here), it just skips the step of that
 * seller logging in themselves to add it.
 */
export async function adminCreateProductAction(
  sellerId: string,
  rawInput: ProductSubmissionRawInput,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const seller = await assertApprovedSeller(sellerId);
  if (!seller.ok) return seller;

  const parsed = productDraftSubmissionSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const priced = await applyNetPayablePricing(parsed.data, sellerId, { strict: false });
  if (!priced.ok) return priced;

  return saveProductDraft(parsed.data, {
    mode: "CREATE",
    sellerId,
    asAdmin: false,
    id: parsed.data.id,
  });
}

/** Mirrors seller/products/actions.ts's submitProductAction — moves the freshly-created DRAFT to SUBMITTED so it lands in the normal admin review queue (Pending products approval), where it — or any other product — gets approved. */
export async function adminSubmitNewProductAction(
  sellerId: string,
  productId: string,
): Promise<SimpleResult> {
  await requireSession(["ADMIN"]);
  const seller = await assertApprovedSeller(sellerId);
  if (!seller.ok) return seller;

  const guard = await assertStoredNetPayableWithinMrp(productId);
  if (!guard.ok) return guard;
  return submitProductForApproval(sellerId, productId);
}

/** Same reasoning as seller/products/actions.ts's uploadProductImageAction — `productId` may still be a client-minted pending id (new, unsaved product). The folder is scoped under the chosen (verified-approved) seller, never a client-supplied one. */
export async function adminNewProductUploadImageAction(
  sellerId: string,
  productId: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  const seller = await assertApprovedSeller(sellerId);
  if (!seller.ok) return { ok: false, error: seller.error };
  if (!isSafeClientId(productId)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(file, catalogImagePaths.productBase(sellerId, productId, slug));
  if (!result.ok) return { ok: false, error: uploadErrorMessage(result.error) };
  return { ok: true, url: result.url };
}

export async function adminNewProductUploadVariantImageAction(
  sellerId: string,
  productId: string,
  productSlug: string,
  variantId: string,
  variantSlug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  const seller = await assertApprovedSeller(sellerId);
  if (!seller.ok) return { ok: false, error: seller.error };
  if (!isSafeClientId(productId) || !isSafeClientId(variantId))
    return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(
    file,
    catalogImagePaths.productVariant(sellerId, productId, productSlug, variantId, variantSlug),
  );
  if (!result.ok) return { ok: false, error: uploadErrorMessage(result.error) };
  return { ok: true, url: result.url };
}
