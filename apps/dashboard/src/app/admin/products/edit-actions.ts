"use server";

import {
  productSubmissionSchema,
  productDraftSubmissionSchema,
  type ProductSubmissionRawInput,
} from "@kisan4u/validators";
import {
  applyProductSubmission,
  saveProductDraft,
  removeVariant,
  removeAttributeValue,
  setDefaultVariant,
} from "@kisan4u/catalog";
import { prisma } from "@kisan4u/db";
import { applyNetPayablePricing } from "@kisan4u/orders";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true; productId: string } | { ok: false; error: string };
type SimpleResult = { ok: true } | { ok: false; error: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

function uploadErrorMessage(error: "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "SIGNATURE_MISMATCH"): string {
  if (error === "FILE_TOO_LARGE") return "File is too large — the maximum size is 5MB.";
  if (error === "SIGNATURE_MISMATCH") return "This file doesn't look like a real image.";
  return "Unsupported file type — upload a JPEG, PNG, or WEBP image.";
}

/** Admin editing an existing product's images — always a real productId (admin never creates a product from scratch), and the folder path uses the product's actual owning seller, looked up server-side, never a client-supplied sellerId. */
export async function adminUploadProductImageAction(
  productId: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { sellerId: true } });
  if (!product?.sellerId) return { ok: false, error: "Product not found or has no owning seller." };

  const result = await uploadCatalogImage(
    file,
    catalogImagePaths.productBase(product.sellerId, productId, slug),
  );
  if (!result.ok) return { ok: false, error: uploadErrorMessage(result.error) };
  return { ok: true, url: result.url };
}

export async function adminUploadVariantImageAction(
  productId: string,
  productSlug: string,
  variantId: string,
  variantSlug: string,
  file: File,
): Promise<UploadResult> {
  await requireSession(["ADMIN"]);
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { sellerId: true } });
  if (!product?.sellerId) return { ok: false, error: "Product not found or has no owning seller." };

  const result = await uploadCatalogImage(
    file,
    catalogImagePaths.productVariant(product.sellerId, productId, productSlug, variantId, variantSlug),
  );
  if (!result.ok) return { ok: false, error: uploadErrorMessage(result.error) };
  return { ok: true, url: result.url };
}

/**
 * Admin editing an existing seller product through the exact same full
 * form as the seller — never touches sellerId/ownership (applyProductSubmission
 * derives the owning seller from the existing row and keeps it) and never
 * touches lifecycleStatus (approve/reject/suspend/reactivate/deactivate stay
 * separate explicit actions in ./actions.ts) — so an edit to an already-
 * APPROVED product takes effect immediately without silently re-triggering
 * approval, and an edit to a DRAFT/SUBMITTED/REJECTED product does not
 * silently approve it either.
 *
 * Validation strictness follows the product's CURRENT status, not who's
 * editing: a DRAFT or REJECTED product (not yet live, and — unlike the
 * seller-only createProductAction/updateProductAction — reachable by an
 * admin through the global product queue) still gets the lenient
 * "save at any point" draft treatment, since it hasn't passed the
 * completeness gate at submit time yet either way. Anything already
 * SUBMITTED/APPROVED/SUSPENDED/INACTIVE keeps the full strict schema — an
 * admin edit must never leave an already-reviewed or live product with
 * placeholder data.
 */
export async function adminUpdateProductAction(
  productId: string,
  rawInput: ProductSubmissionRawInput,
): Promise<Result> {
  await requireSession(["ADMIN"]);
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { lifecycleStatus: true, sellerId: true },
  });
  if (!existing) return { ok: false, error: "Product not found." };
  if (!existing.sellerId) return { ok: false, error: "Product has no owning seller." };
  const sellerId = existing.sellerId;

  if (existing.lifecycleStatus === "DRAFT" || existing.lifecycleStatus === "REJECTED") {
    const parsed = productDraftSubmissionSchema.safeParse(rawInput);
    if (!parsed.success)
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const priced = await applyNetPayablePricing(parsed.data, sellerId, { strict: false });
    if (!priced.ok) return priced;
    return saveProductDraft(parsed.data, { mode: "UPDATE", productId, asAdmin: true });
  }

  const parsed = productSubmissionSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const priced = await applyNetPayablePricing(parsed.data, sellerId, { strict: true });
  if (!priced.ok) return priced;
  return applyProductSubmission(parsed.data, { mode: "UPDATE", productId, asAdmin: true });
}

export async function adminRemoveVariantAction(variantId: string): Promise<SimpleResult> {
  await requireSession(["ADMIN"]);
  return removeVariant(variantId);
}

export async function adminRemoveAttributeValueAction(valueId: string): Promise<SimpleResult> {
  await requireSession(["ADMIN"]);
  return removeAttributeValue(valueId);
}

export async function adminSetDefaultVariantAction(variantId: string): Promise<SimpleResult> {
  await requireSession(["ADMIN"]);
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  return setDefaultVariant(variant.productId, variant.audience, variantId);
}
