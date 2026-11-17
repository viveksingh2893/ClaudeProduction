"use server";

import { prisma } from "@kisan4u/db";
import {
  productDraftSubmissionSchema,
  productSubmissionSchema,
  type ProductSubmissionRawInput,
} from "@kisan4u/validators";
import {
  assertOwnsProduct,
  saveProductDraft,
  applyProductSubmission,
  removeVariant,
  removeAttributeValue,
  setDefaultVariant,
  submitProductForApproval,
  revertProductToDraft,
  deactivateOwnProduct,
  reactivateOwnProduct,
  deleteProduct,
} from "@kisan4u/catalog";
import { applyNetPayablePricing, assertStoredNetPayableWithinMrp } from "@kisan4u/orders";
import { uploadCatalogImage, catalogImagePaths } from "@kisan4u/providers";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

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
 * A product's own images (primary + gallery) live under its `base` folder
 * regardless of whether it has variants (spec §3: "For a product without
 * variants, store images under the product's base folder"). `productId`
 * may be a client-minted pending id (new, unsaved product) or a real
 * existing product's id — either way the folder is scoped under the
 * CALLER's own sellerId (from session, never client-supplied), so this
 * never needs a separate ownership lookup: the upload step can only ever
 * land under the uploader's own seller folder. Actually attaching the
 * returned URL to a specific product is separately gated by
 * assertOwnsProduct inside updateProductAction/applyProductSubmission.
 */
export async function uploadProductImageAction(
  productId: string,
  slug: string,
  file: File,
): Promise<UploadResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  if (!isSafeClientId(productId)) return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(
    file,
    catalogImagePaths.productBase(sellerProfileId, productId, slug),
  );
  if (!result.ok) return { ok: false, error: uploadErrorMessage(result.error) };
  return { ok: true, url: result.url };
}

/** Same reasoning as uploadProductImageAction, one level deeper — see catalogImagePaths.productVariant. variantId may also be a client-minted pending id for a not-yet-saved variant. */
export async function uploadVariantImageAction(
  productId: string,
  productSlug: string,
  variantId: string,
  variantSlug: string,
  file: File,
): Promise<UploadResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  if (!isSafeClientId(productId) || !isSafeClientId(variantId))
    return { ok: false, error: "Invalid request." };

  const result = await uploadCatalogImage(
    file,
    catalogImagePaths.productVariant(sellerProfileId, productId, productSlug, variantId, variantSlug),
  );
  if (!result.ok) return { ok: false, error: uploadErrorMessage(result.error) };
  return { ok: true, url: result.url };
}

/**
 * A seller's product is never in any status other than DRAFT the moment
 * it's created — Save is always the "save at any point, even if a lot of
 * fields are empty" draft path (see productDraftSubmissionSchema's doc
 * comment). Full correctness is only ever enforced once, when the seller
 * actually submits it for approval (submitProductAction below).
 */
export async function createProductAction(rawInput: ProductSubmissionRawInput): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const parsed = productDraftSubmissionSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // NET_PAYABLE mode: back-solve each unit's selling price from its net
  // payable and fill in discountType/discountValue in place. Lenient here
  // (a still-incomplete draft never blocks on it); the strict check runs
  // at "Submit for approval" / when editing a live product.
  const priced = await applyNetPayablePricing(parsed.data, sellerProfileId, { strict: false });
  if (!priced.ok) return priced;

  return saveProductDraft(parsed.data, {
    mode: "CREATE",
    sellerId: sellerProfileId,
    asAdmin: false,
    id: parsed.data.id,
  });
}

/**
 * DRAFT/REJECTED (never yet live) still goes through the lenient
 * "save at any point" draft path — see productDraftSubmissionSchema's doc
 * comment; both rely on the separate, explicit "Submit for approval"
 * click (submitProductAction, full strict validation) once the seller
 * thinks it's ready — see product-form.tsx's handleSubmitForApproval,
 * which saves AND resubmits in that one click. APPROVED (currently live)
 * is different on purpose: it uses the full STRICT schema instead, so an
 * edit can never persist a half-broken state into what customers are
 * looking at right now, and then — only once that strict save actually
 * succeeds — is immediately resubmitted for admin re-review (APPROVED ->
 * SUBMITTED, see lifecycle.ts), which pulls it off the storefront until
 * reviewed again. Any other status (SUBMITTED/SUSPENDED/INACTIVE) still
 * can't be edited at all here.
 */
export async function updateProductAction(
  productId: string,
  rawInput: ProductSubmissionRawInput,
): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const owns = await assertOwnsProduct(sellerProfileId, productId);
  if (!owns.ok) return { ok: false, error: owns.error };

  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { lifecycleStatus: true },
  });
  if (!existing) return { ok: false, error: "Product not found." };

  if (existing.lifecycleStatus === "DRAFT" || existing.lifecycleStatus === "REJECTED") {
    const parsed = productDraftSubmissionSchema.safeParse(rawInput);
    if (!parsed.success)
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const priced = await applyNetPayablePricing(parsed.data, sellerProfileId, { strict: false });
    if (!priced.ok) return priced;
    return saveProductDraft(parsed.data, { mode: "UPDATE", productId, asAdmin: false });
  }

  if (existing.lifecycleStatus !== "APPROVED") {
    return { ok: false, error: "This product's status doesn't allow editing right now." };
  }

  const parsed = productSubmissionSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Live product — strict: a net payable that can't be turned into a valid
  // sub-MRP selling price rejects the whole save (with the exact ceiling).
  const priced = await applyNetPayablePricing(parsed.data, sellerProfileId, { strict: true });
  if (!priced.ok) return priced;

  const saveResult = await applyProductSubmission(parsed.data, {
    mode: "UPDATE",
    productId,
    asAdmin: false,
  });
  if (!saveResult.ok) return saveResult;

  const resubmit = await submitProductForApproval(sellerProfileId, productId);
  if (!resubmit.ok) {
    return { ok: false, error: `Saved, but couldn't resubmit for review: ${resubmit.error}` };
  }
  return saveResult;
}

async function assertOwnsVariant(
  sellerProfileId: string,
  variantId: string,
): Promise<SimpleResult> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });
  if (!variant) return { ok: false, error: "Variant not found." };
  return assertOwnsProduct(sellerProfileId, variant.productId);
}

async function assertOwnsAttributeValue(
  sellerProfileId: string,
  valueId: string,
): Promise<SimpleResult> {
  const value = await prisma.productVariantAttributeValue.findUnique({
    where: { id: valueId },
    select: { productId: true },
  });
  if (!value) return { ok: false, error: "Attribute value not found." };
  return assertOwnsProduct(sellerProfileId, value.productId);
}

export async function removeVariantAction(variantId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  const owns = await assertOwnsVariant(sellerProfileId, variantId);
  if (!owns.ok) return owns;
  return removeVariant(variantId);
}

export async function removeAttributeValueAction(valueId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  const owns = await assertOwnsAttributeValue(sellerProfileId, valueId);
  if (!owns.ok) return owns;
  return removeAttributeValue(valueId);
}

export async function setDefaultVariantAction(variantId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  const owns = await assertOwnsVariant(sellerProfileId, variantId);
  if (!owns.ok) return owns;
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  return setDefaultVariant(variant.productId, variant.audience, variantId);
}

export async function submitProductAction(productId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  // Belt-and-braces for a NET_PAYABLE product saved via the lenient draft
  // path: re-derive from the stored figures and refuse the submit if any
  // unit's implied selling price now sits above its MRP.
  const guard = await assertStoredNetPayableWithinMrp(productId);
  if (!guard.ok) return guard;
  return submitProductForApproval(sellerProfileId, productId);
}

export async function revertToDraftAction(productId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  return revertProductToDraft(sellerProfileId, productId);
}

export async function deactivateProductAction(productId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  return deactivateOwnProduct(sellerProfileId, productId);
}

export async function reactivateProductAction(productId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  return reactivateOwnProduct(sellerProfileId, productId);
}

/**
 * Seller-scoped delete — deleteProduct itself (packages/catalog) has no
 * actor/ownership concept of its own (same as the admin-only
 * deleteProductAction in admin/products/actions.ts), so ownership is
 * checked here first, the same layering every other seller action in this
 * file already uses. Blocked regardless of status if the product has ever
 * been ordered (deleteProduct's own guard) — a seller can't erase order
 * history by deleting the product it points at.
 */
export async function deleteProductAction(productId: string): Promise<SimpleResult> {
  const { sellerProfileId } = await requireApprovedSeller();
  const owns = await assertOwnsProduct(sellerProfileId, productId);
  if (!owns.ok) return owns;
  return deleteProduct(productId);
}
