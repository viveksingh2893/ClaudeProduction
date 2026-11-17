import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Local-disk file storage — per NEXTJS_ARCHITECTURE_PLAN.md §7, this is
 * the dev/self-hosted implementation behind a small interface so a real
 * provider (S3-compatible) can swap in later without touching callers.
 *
 * Files land under `<app cwd>/storage/uploads/<subdir>/` — deliberately
 * OUTSIDE `public/`. Next.js's production server (`next start`) resolves
 * its public-folder static routes once at boot, so a file written to
 * `public/` after the server is already running 404s until the next
 * restart. Callers must serve the returned url through a Route Handler
 * that reads from disk per-request (see
 * apps/web/src/app/api/uploads/[...path]/route.ts) instead of relying on
 * Next's static file serving.
 */
export interface StorageProvider {
  upload(file: File, subdir: string): Promise<string>;
  delete(url: string): Promise<void>;
}

/**
 * Every app that serves uploaded files back out (currently only
 * apps/web, via app/api/uploads/[...path]/route.ts) defaults to its own
 * cwd-relative storage dir, unchanged from before. A DIFFERENT app that
 * only ever WRITES uploads (apps/dashboard's admin-side POS dealer
 * registration — see apps/dashboard/src/app/admin/pos/actions.ts) sets
 * `UPLOAD_STORAGE_ROOT` to point at apps/web's storage dir directly, so a
 * file it writes lands somewhere the existing serving route can actually
 * find it — both apps currently run on the same host/filesystem (see
 * systemd unit WorkingDirectory), the same assumption
 * apps/dashboard/src/lib/storefront-url.ts already makes for the read
 * side via STOREFRONT_PUBLIC_URL. If the apps are ever split across
 * hosts, this env var (and STOREFRONT_PUBLIC_URL) would need to become a
 * real upload API call instead — not attempted here since it isn't the
 * deployment reality today.
 */
const UPLOAD_ROOT = process.env.UPLOAD_STORAGE_ROOT
  ? path.resolve(process.env.UPLOAD_STORAGE_ROOT)
  : path.join(process.cwd(), "storage", "uploads");
const UPLOAD_URL_PREFIX = "/api/uploads";

const PRIVATE_KYC_FOLDERS = new Set(["dealer-documents", "ba-documents", "seller-documents"]);

/** Public upload serving must fail closed for every KYC folder. */
export function isPrivateKycUploadSubpath(subpath: readonly string[]): boolean {
  return subpath.length === 0 || PRIVATE_KYC_FOLDERS.has(subpath[0]!.toLowerCase());
}

function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  // Whitelist only — an unrecognized/absent extension is dropped rather
  // than trusted verbatim, since it flows straight into a filesystem path.
  // .mp4/.webm/.mov added for return-request evidence videos (see the
  // Return-request evidence uploads section below) — harmless to allow
  // through the private-document path too, nothing there ever uploads one.
  const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm", ".mov"];
  return allowed.includes(ext) ? ext : "";
}

export const localStorageProvider: StorageProvider = {
  async upload(file, subdir) {
    const filename = `${randomUUID()}${safeExtension(file.name)}`;
    const dir = path.join(UPLOAD_ROOT, subdir);
    await mkdir(dir, { recursive: true });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(path.join(dir, filename), bytes);
    return `${UPLOAD_URL_PREFIX}/${subdir}/${filename}`;
  },

  async delete(url) {
    if (!url.startsWith(`${UPLOAD_URL_PREFIX}/`)) return;
    const relative = url.slice(`${UPLOAD_URL_PREFIX}/`.length);
    // Reject anything that could escape UPLOAD_ROOT (e.g. "../../etc/passwd").
    if (relative.includes("..")) return;
    await unlink(path.join(UPLOAD_ROOT, relative)).catch(() => {});
  },
};

/** Resolves a url returned by `upload()` back to an absolute filesystem path, or null if it's not a valid one — used by the serving route handler. */
export function resolveUploadPath(subpath: string[]): string | null {
  const relative = path.join(...subpath);
  if (relative.includes("..")) return null;
  return path.join(UPLOAD_ROOT, relative);
}

// ---------------------------------------------------------------------------
// Private document storage — all identity/KYC/payment documents.
//
// Deliberately a SEPARATE root from UPLOAD_ROOT above, not a subdir inside
// it: apps/web's `/api/uploads/[...path]` route (see
// apps/web/src/app/api/uploads/[...path]/route.ts) serves ANY file under
// UPLOAD_ROOT to anyone who knows the path, with no auth check at all —
// that's an accepted tradeoff for onboarding/GST documents (mitigated only
// by random UUID filenames), but the selling-licence module spec requires
// these documents to be genuinely private. Putting them in a directory the
// public route's UPLOAD_ROOT can never resolve into means no path/UUID
// leak can ever expose one — access is only possible through
// resolvePrivateDocumentPath + an authenticated route handler that checks
// ownership first (see apps/dashboard's seller-licence document route).
//
// Callers never see or store a filesystem path — only the opaque
// `storageKey` returned by `uploadPrivateDocument`, which an authenticated
// route resolves server-side. Nothing renders this key as a URL.
const PRIVATE_UPLOAD_ROOT = process.env.PRIVATE_LICENCE_UPLOAD_ROOT
  ? path.resolve(process.env.PRIVATE_LICENCE_UPLOAD_ROOT)
  : path.join(process.cwd(), "storage", "private-licences");

export const PRIVATE_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const PRIVATE_DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PrivateDocumentValidationError =
  "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "CONTENT_MISMATCH" | "UNSAFE_PDF";

export type DetectedFileType = {
  mimeType:
    | "application/pdf"
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "video/mp4"
    | "video/quicktime"
    | "video/webm";
  extension: ".pdf" | ".jpg" | ".png" | ".webp" | ".mp4" | ".mov" | ".webm";
  unsafePdf?: boolean;
};

function startsWithBytes(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Detects supported content from bytes only; browser MIME and filename are never trusted. */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    const text = Buffer.from(bytes).toString("latin1");
    if (!text.slice(-2048).includes("%%EOF")) return null;
    return {
      mimeType: "application/pdf",
      extension: ".pdf",
      unsafePdf: /\/(JavaScript|JS|OpenAction|AA|Launch)\b/i.test(text),
    };
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff]))
    return { mimeType: "image/jpeg", extension: ".jpg" };
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mimeType: "image/png", extension: ".png" };
  if (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return { mimeType: "image/webp", extension: ".webp" };
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]))
    return { mimeType: "video/webm", extension: ".webm" };
  if (bytes.length >= 12 && startsWithBytes(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
    return brand === "qt  "
      ? { mimeType: "video/quicktime", extension: ".mov" }
      : { mimeType: "video/mp4", extension: ".mp4" };
  }
  return null;
}

function extensionMatches(filename: string, detected: DetectedFileType): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (detected.mimeType === "image/jpeg") return ext === ".jpg" || ext === ".jpeg";
  return ext === detected.extension;
}

export async function validatePrivateDocumentContent(
  file: File,
): Promise<PrivateDocumentValidationError | null> {
  if (file.size > PRIVATE_DOCUMENT_MAX_BYTES) return "FILE_TOO_LARGE";
  const detected = detectFileType(new Uint8Array(await file.arrayBuffer()));
  if (
    !detected ||
    !(PRIVATE_DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(detected.mimeType)
  )
    return "UNSUPPORTED_TYPE";
  if (!extensionMatches(file.name, detected)) return "CONTENT_MISMATCH";
  if (detected.unsafePdf) return "UNSAFE_PDF";
  return null;
}

/** Same 5MB + pdf/jpeg/png/webp policy as the existing dealer-document upload routes (packages/providers's only other file-accepting callers) — centralized here instead of duplicated per caller. */
export function validatePrivateDocument(file: File): PrivateDocumentValidationError | null {
  if (file.size > PRIVATE_DOCUMENT_MAX_BYTES) return "FILE_TOO_LARGE";
  if (!(PRIVATE_DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type))
    return "UNSUPPORTED_TYPE";
  return null;
}

export const POS_PAYMENT_PROOF_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Screenshot-only sibling of validatePrivateDocument (no PDF) — a POS payment proof is specifically a photo of a payment confirmation, never a document. Same 5MB ceiling, doesn't touch the shared licence constant. */
export async function validatePosPaymentProofImage(
  file: File,
): Promise<PrivateDocumentValidationError | null> {
  if (file.size > PRIVATE_DOCUMENT_MAX_BYTES) return "FILE_TOO_LARGE";
  const detected = detectFileType(new Uint8Array(await file.arrayBuffer()));
  if (!detected || !detected.mimeType.startsWith("image/")) return "UNSUPPORTED_TYPE";
  if (!extensionMatches(file.name, detected)) return "CONTENT_MISMATCH";
  return null;
}

export type UploadedPrivateDocument = { storageKey: string; mimeType: string; sizeBytes: number };

/**
 * Writes a validated file under PRIVATE_UPLOAD_ROOT/<subdir>/<uuid>.<ext>
 * and returns the relative storageKey (never an absolute path, never a
 * URL) — caller persists this string in the owning DB row. Throws if the
 * file fails validatePrivateDocument; callers must call that first so they
 * can surface a field-level error instead of a thrown exception, but this
 * still re-validates defensively since it's the last line of defense
 * before anything touches the filesystem.
 */
export async function uploadPrivateDocument(
  file: File,
  subdir: string,
): Promise<UploadedPrivateDocument> {
  const validationError = await validatePrivateDocumentContent(file);
  if (validationError) throw new Error(`Invalid document upload: ${validationError}`);
  if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(subdir) || subdir.includes("..")) {
    throw new Error("Invalid private document directory.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFileType(bytes)!;
  const filename = `${randomUUID()}${detected.extension}`;
  const dir = path.join(PRIVATE_UPLOAD_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return { storageKey: `${subdir}/${filename}`, mimeType: detected.mimeType, sizeBytes: file.size };
}

/** Path-traversal-guarded resolution of a stored storageKey back to an absolute filesystem path — null if it's not valid. Used only by the authenticated document-serving route, never exposed to a client. */
export function resolvePrivateDocumentPath(storageKey: string): string | null {
  if (!isPrivateDocumentStorageKey(storageKey)) return null;
  const resolved = path.resolve(PRIVATE_UPLOAD_ROOT, storageKey);
  const rootWithSeparator = `${path.resolve(PRIVATE_UPLOAD_ROOT)}${path.sep}`;
  return resolved.startsWith(rootWithSeparator) ? resolved : null;
}

/** Opaque references stored in the database never begin with a slash or expose an absolute path. */
export function isPrivateDocumentStorageKey(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !path.isAbsolute(value) &&
    !value.includes("..") &&
    /^[a-z0-9][a-z0-9/_.-]*$/i.test(value)
  );
}

export async function deletePrivateDocument(storageKey: string): Promise<void> {
  const target = resolvePrivateDocumentPath(storageKey);
  if (!target) return;
  await unlink(target).catch(() => {});
}

// Seller agreement PDFs — same private root and storageKey convention as
// the licence documents above, PDF only. 8 MB stays under the dashboard's
// 10 MB server-action body limit (apps/dashboard/next.config.ts).
export const SELLER_AGREEMENT_MAX_BYTES = 8 * 1024 * 1024;

export async function validateSellerAgreement(
  file: File,
): Promise<PrivateDocumentValidationError | null> {
  if (file.size > SELLER_AGREEMENT_MAX_BYTES) return "FILE_TOO_LARGE";
  const detected = detectFileType(new Uint8Array(await file.arrayBuffer()));
  if (!detected || detected.mimeType !== "application/pdf") return "UNSUPPORTED_TYPE";
  if (!extensionMatches(file.name, detected)) return "CONTENT_MISMATCH";
  if (detected.unsafePdf) return "UNSAFE_PDF";
  return null;
}

export async function uploadSellerAgreement(
  file: File,
  sellerProfileId: string,
): Promise<UploadedPrivateDocument> {
  const validationError = await validateSellerAgreement(file);
  if (validationError) throw new Error(`Invalid agreement upload: ${validationError}`);
  if (!/^[a-z0-9]+$/i.test(sellerProfileId)) throw new Error("Invalid seller id.");

  const subdir = `seller-agreements/${sellerProfileId}`;
  const filename = `${randomUUID()}.pdf`;
  const dir = path.join(PRIVATE_UPLOAD_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), new Uint8Array(await file.arrayBuffer()));
  return { storageKey: `${subdir}/${filename}`, mimeType: "application/pdf", sizeBytes: file.size };
}

/** Deletes either a public upload URL or a private document storage key. */
export async function deleteStoredFile(reference: string): Promise<void> {
  if (!reference || reference.includes("..")) return;
  const target = reference.startsWith(`${UPLOAD_URL_PREFIX}/`)
    ? path.join(UPLOAD_ROOT, reference.slice(`${UPLOAD_URL_PREFIX}/`.length))
    : resolvePrivateDocumentPath(reference);
  if (!target) return;
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

// ---------------------------------------------------------------------------
// Public catalog/product image uploads — categories, subcategories,
// sub-subcategories, brands, manufacturers, products, and product variants.
// These go through the same `localStorageProvider` (public, served via
// /api/uploads/[...path]) as everything else in this file's non-private
// section — the only thing this block adds is (a) image-specific
// server-side validation (stricter than the generic upload's bare
// extension whitelist: MIME type, size, and a magic-byte signature check
// so a renamed non-image file can't slip through even with a spoofed
// Content-Type) and (b) the folder-path builders that enforce the required
// catalog-images/... and product-images/sellers/... hierarchy so images
// for different entity types/sellers/products/variants can never land in
// the same directory.

export const CATALOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CATALOG_IMAGE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type CatalogImageValidationError =
  "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "SIGNATURE_MISMATCH";

// Magic-byte prefixes for the three allowed types — enough bytes to be
// unambiguous without needing a full image-parsing library. A file whose
// declared MIME type doesn't match its actual bytes is rejected outright,
// closing the "rename a .exe to .jpg" class of spoof that a bare
// extension/Content-Type check can't catch.
const SIGNATURES: Record<string, readonly number[][]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // WEBP is RIFF????WEBP — bytes 0-3 "RIFF", bytes 8-11 "WEBP".
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
};

function matchesSignature(bytes: Uint8Array, mimeType: string): boolean {
  const candidates = SIGNATURES[mimeType];
  if (!candidates) return false;
  if (mimeType === "image/webp") {
    return (
      bytes.length >= 12 &&
      candidates[0]!.every((b, i) => bytes[i] === b) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return candidates.some(
    (sig) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b),
  );
}

/** Server-side re-validation for every catalog/product image upload — never trust the client's reported file.type alone. Callers that need the signature check must read the file's bytes first (see validateCatalogImageBytes); this synchronous half covers size/MIME and is cheap to call before that. */
export function validateCatalogImage(file: File): CatalogImageValidationError | null {
  if (file.size > CATALOG_IMAGE_MAX_BYTES) return "FILE_TOO_LARGE";
  if (!(CATALOG_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type))
    return "UNSUPPORTED_TYPE";
  return null;
}

/** The signature-checking half — async because it needs the file's bytes. Called by uploadCatalogImage as the last line of defense; exposed separately so a server action can also call it to give a specific "this isn't really a JPEG" error before attempting the upload. */
export async function validateCatalogImageBytes(
  file: File,
): Promise<CatalogImageValidationError | null> {
  const syncError = validateCatalogImage(file);
  if (syncError) return syncError;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesSignature(head, file.type)) return "SIGNATURE_MISMATCH";
  return null;
}

function safeSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (slug || "item").slice(0, 60);
}

/**
 * Folder-path builders for the exact hierarchy the spec requires. Every
 * one of these uses the entity's immutable database id as the directory's
 * real identity — the slug is appended only for human readability when
 * browsing the filesystem directly, and is never itself load-bearing (a
 * later rename never has to move files). Each returns the `subdir`
 * argument for `localStorageProvider.upload`/`.delete`, which appends the
 * `{uuid}.{extension}` filename itself.
 */
export const catalogImagePaths = {
  category: (categoryId: string, slug: string) =>
    `catalog-images/categories/${categoryId}-${safeSlug(slug)}`,
  subcategory: (subcategoryId: string, slug: string) =>
    `catalog-images/subcategories/${subcategoryId}-${safeSlug(slug)}`,
  subSubcategory: (subSubcategoryId: string, slug: string) =>
    `catalog-images/sub-subcategories/${subSubcategoryId}-${safeSlug(slug)}`,
  brand: (brandId: string, slug: string) => `catalog-images/brands/${brandId}-${safeSlug(slug)}`,
  manufacturer: (manufacturerId: string, slug: string) =>
    `catalog-images/manufacturers/${manufacturerId}-${safeSlug(slug)}`,
  crop: (cropId: string, slug: string) => `catalog-images/crops/${cropId}-${safeSlug(slug)}`,
  pestDisease: (pestDiseaseId: string, slug: string) =>
    `catalog-images/pests-diseases/${pestDiseaseId}-${safeSlug(slug)}`,
  blog: (blogId: string, slug: string) => `catalog-images/blogs/${blogId}-${safeSlug(slug)}`,
  /** Homepage / category HERO + COUPON banner images (no per-row id needed — the provider appends a uuid filename). */
  banner: () => `catalog-images/banners`,
  /** A product without variants stores its images here too (spec: "For a product without variants, store images under the product's base folder"). */
  productBase: (sellerId: string, productId: string, slug: string) =>
    `product-images/sellers/${sellerId}/${productId}-${safeSlug(slug)}/base`,
  productVariant: (
    sellerId: string,
    productId: string,
    productSlug: string,
    variantId: string,
    variantSlug: string,
  ) =>
    `product-images/sellers/${sellerId}/${productId}-${safeSlug(productSlug)}/variants/${variantId}-${safeSlug(variantSlug)}`,
};

export type TagIconValidationError = "NOT_PNG" | "NOT_SQUARE" | "NO_TRANSPARENCY";

/**
 * Extra check for the home page "Shop by Crop" / "Shop by Pest & Disease"
 * tiles, which show the image in place of the emoji: a 1:1 PNG with its
 * background removed (an alpha channel), so it sits cleanly on the tile's
 * circle. Run before uploadCatalogImage (which still does size/signature).
 */
export async function validateTagIconPng(file: File): Promise<TagIconValidationError | null> {
  if (file.type !== "image/png") return "NOT_PNG";
  const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
  if (meta.format !== "png") return "NOT_PNG";
  const { width, height } = meta;
  // 2% slack so an export that's a pixel or two off still counts as square.
  if (!width || !height || Math.abs(width - height) > Math.max(width, height) * 0.02)
    return "NOT_SQUARE";
  if (!meta.hasAlpha) return "NO_TRANSPARENCY";
  return null;
}

/** Validates (size/MIME/signature) then uploads through localStorageProvider — the one call site every catalog/product image upload action should use, so validation can never accidentally be skipped by a new caller. */
export async function uploadCatalogImage(
  file: File,
  subdir: string,
): Promise<{ ok: true; url: string } | { ok: false; error: CatalogImageValidationError }> {
  const error = await validateCatalogImageBytes(file);
  if (error) return { ok: false, error };
  const url = await localStorageProvider.upload(file, subdir);
  return { ok: true, url };
}

/**
 * Deliberate omission — there is no `deleteCatalogImage`/replace-cleanup
 * helper here, and none of the entity update actions
 * (admin/categories|subcategories|sub-subcategories|brands|manufacturers/
 * actions.ts, seller/products/actions.ts, admin/products/edit-actions.ts)
 * ever call `localStorageProvider.delete()` when a URL field changes to a
 * new upload/URL — replacing an image only ever writes the new URL into
 * the owning row (after validation, atomically alongside the rest of that
 * entity's fields), never removes the previous file from disk. This is
 * the safety trade-off spec §3 asks for explicitly: "Do not delete an
 * image still referenced by an order snapshot or another entity" — a
 * historical OrderItem.productImageUrl is a plain string COPY of
 * whatever URL was current at order time (see packages/orders/src/
 * line-validation.ts), not a live foreign key, so there is no cheap way
 * to know here whether some past order (or another entity that happens
 * to reference the exact same URL, e.g. an admin manually reusing a
 * catalog image via "Use image URL") still depends on the old file.
 * The accepted cost is that replaced/removed images accumulate as orphan
 * files on disk over time rather than being reclaimed automatically — a
 * future dedicated cleanup sweep (compare every stored file against every
 * URL column + every OrderItem.productImageUrl before deleting) would be
 * the correct way to reclaim that space, not an inline delete-on-replace
 * that could silently break a still-live reference.
 */

// ---------------------------------------------------------------------------
// Return-request evidence uploads — customer-supplied photos (mandatory,
// at least one) and an optional short video, attached to a post-delivery
// RefundRequest (packages/orders/src/refunds.ts's requestReturn).
//
// Deliberately routed through the PUBLIC localStorageProvider (same as
// catalog/product images), not the private/authenticated document tier
// POS payment-proof screenshots use — a photo of a damaged/wrong product
// is evidence closer in sensitivity to a product photo than to a bank
// statement or payment screenshot, and both seller and admin need to view
// it without a new dual-role authenticated serving route. Same accepted
// tradeoff as catalog images: no auth check on the serving route,
// mitigated by a random UUID filename (see uploadCatalogImage's own doc
// comment above for the fuller reasoning).

export const RETURN_MEDIA_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const RETURN_MEDIA_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const RETURN_MEDIA_ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
// video/quicktime (.mov) included for a phone-camera clip uploaded
// straight from an iPhone/Safari without transcoding first.
export const RETURN_MEDIA_ALLOWED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export type ReturnMediaValidationError = "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "CONTENT_MISMATCH";

/** Sync size/MIME check only (no magic-byte signature check, same lighter-weight tier as validatePosPaymentProofImage — a mis-signed file here only ever gets rendered back as an <img>/<video>, never parsed as anything more dangerous). */
export function validateReturnMediaImage(file: File): ReturnMediaValidationError | null {
  if (file.size > RETURN_MEDIA_IMAGE_MAX_BYTES) return "FILE_TOO_LARGE";
  return null;
}

export function validateReturnMediaVideo(file: File): ReturnMediaValidationError | null {
  if (file.size > RETURN_MEDIA_VIDEO_MAX_BYTES) return "FILE_TOO_LARGE";
  return null;
}

/** Keyed by orderItemId (not a RefundRequest id, which doesn't exist yet at upload time — the customer uploads media before submitting the request) — matches the "one active request per item" invariant requestReturn already enforces. */
export function returnMediaPath(sellerOrderId: string, orderItemId: string): string {
  return `return-media/${sellerOrderId}/${orderItemId}`;
}

/** Validates then uploads a single evidence image — the one call site requestReturn's upload action should use. */
export async function uploadReturnMediaImage(
  file: File,
  sellerOrderId: string,
  orderItemId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: ReturnMediaValidationError }> {
  const error = validateReturnMediaImage(file);
  if (error) return { ok: false, error };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFileType(bytes);
  if (
    !detected ||
    !(RETURN_MEDIA_ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(detected.mimeType) ||
    !extensionMatches(file.name, detected)
  ) {
    return { ok: false, error: "CONTENT_MISMATCH" };
  }
  const subdir = returnMediaPath(sellerOrderId, orderItemId);
  const dir = path.join(UPLOAD_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}${detected.extension}`;
  await writeFile(path.join(dir, filename), bytes);
  const url = `${UPLOAD_URL_PREFIX}/${subdir}/${filename}`;
  return { ok: true, url };
}

/** Same as uploadReturnMediaImage, for the single optional video. */
export async function uploadReturnMediaVideo(
  file: File,
  sellerOrderId: string,
  orderItemId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: ReturnMediaValidationError }> {
  const error = validateReturnMediaVideo(file);
  if (error) return { ok: false, error };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFileType(bytes);
  if (
    !detected ||
    !(RETURN_MEDIA_ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(detected.mimeType) ||
    !extensionMatches(file.name, detected)
  ) {
    return { ok: false, error: "CONTENT_MISMATCH" };
  }
  const subdir = returnMediaPath(sellerOrderId, orderItemId);
  const dir = path.join(UPLOAD_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}${detected.extension}`;
  await writeFile(path.join(dir, filename), bytes);
  const url = `${UPLOAD_URL_PREFIX}/${subdir}/${filename}`;
  return { ok: true, url };
}

// --- App login-screen background video ------------------------------------

export const APP_LOGIN_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const APP_LOGIN_VIDEO_ALLOWED_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export function validateAppLoginVideo(file: File): ReturnMediaValidationError | null {
  if (file.size > APP_LOGIN_VIDEO_MAX_BYTES) return "FILE_TOO_LARGE";
  if (!(APP_LOGIN_VIDEO_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type))
    return "UNSUPPORTED_TYPE";
  return null;
}

/** The single silent looping clip played behind the mobile app's login screen (SiteSettings.loginVideoUrl). Written from /admin/app-login-video. */
export async function uploadAppLoginVideo(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: ReturnMediaValidationError }> {
  const error = validateAppLoginVideo(file);
  if (error) return { ok: false, error };
  const url = await localStorageProvider.upload(file, "app/login-video");
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Bulk product-entry image processing pipeline ("Add Multiple Products"
// spec) — a NEW, additive capability. `uploadCatalogImage` above is
// deliberately left untouched: the existing single-product form and every
// other current image-upload caller keeps its exact current behavior, so
// this pipeline can't regress anything already working. A future decision
// to move those callers onto this same pipeline is a reasonable follow-up,
// not attempted here.
//
// Every image — device upload or URL — goes through the same
// `processImageBuffer` core: EXIF auto-rotate, three fixed square sizes
// (thumbnail/medium/main), letterboxed onto a white background without
// cropping or stretching (existing transparency in the source content
// itself is preserved — only the added padding is filled white), stripped
// metadata, converted to WebP. Returns platform-owned URLs under the same
// localStorageProvider used everywhere else — never a raw upstream URL.
// ---------------------------------------------------------------------------

const PROCESSED_IMAGE_SIZES = { thumbnail: 300, medium: 800, main: 1200 } as const;
type ProcessedSizeKey = keyof typeof PROCESSED_IMAGE_SIZES;
const MAIN_IMAGE_TARGET_BYTES = 500 * 1024;
const MIN_RECOMMENDED_DIMENSION = 800;

export type ProcessedImageUrls = {
  url: string; // "main" size — the one URL every existing consumer expects
  thumbnailUrl: string;
  mediumUrl: string;
  /** Original (post-rotation) source dimensions — not the output canvas size — so the caller can apply the "warn below ~800x800" rule against what the seller actually supplied. */
  sourceWidth: number;
  sourceHeight: number;
  sizeBytes: number;
  /** Spec: "Warn when the source is below approximately 800x800 pixels." Never blocks saving a draft; the bulk submission validator is what turns this into a hard block before final submit. */
  belowRecommendedSize: boolean;
};

export type ProcessImageResult =
  | { ok: true; urls: ProcessedImageUrls }
  | { ok: false; error: CatalogImageValidationError | "PROCESSING_FAILED" };

/** Buffer-level signature check — same allowlist/logic as matchesSignature above, reused so device uploads and URL fetches validate identically regardless of how the bytes arrived. */
function detectSignatureMimeType(bytes: Uint8Array): string | null {
  for (const mime of Object.keys(SIGNATURES)) {
    if (matchesSignature(bytes, mime)) return mime;
  }
  return null;
}

async function encodeSquareWebp(
  sourceBuffer: Buffer,
  dimension: number,
  quality: number,
): Promise<Buffer> {
  return sharp(sourceBuffer)
    .rotate() // auto-orient from EXIF before anything else touches geometry
    .resize(dimension, dimension, {
      fit: "contain", // never crop product content, never stretch
      background: { r: 255, g: 255, b: 255, alpha: 1 }, // white canvas padding only — real alpha in the source content is untouched by "contain" fit
    })
    .webp({ quality })
    .toBuffer();
}

/**
 * The shared processing core — device uploads and URL fetches both funnel
 * through this exact function so there is only one place the actual image
 * transformation logic lives. `declaredMimeType` is whatever the caller
 * already claims (browser File.type, or the upstream Content-Type header)
 * but is NEVER trusted alone — the real gate is the magic-byte signature
 * check against the raw bytes, same convention as validateCatalogImage.
 */
export async function processImageBuffer(
  buffer: Buffer,
  declaredMimeType: string,
  sizeLimitBytes: number,
  subdir: string,
): Promise<ProcessImageResult> {
  if (buffer.byteLength > sizeLimitBytes) return { ok: false, error: "FILE_TOO_LARGE" };
  if (!(CATALOG_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(declaredMimeType)) {
    return { ok: false, error: "UNSUPPORTED_TYPE" };
  }
  const realMimeType = detectSignatureMimeType(buffer.subarray(0, 16));
  if (!realMimeType) return { ok: false, error: "SIGNATURE_MISMATCH" };

  try {
    const metadata = await sharp(buffer).metadata();
    // Explicit SVG rejection (spec item, defense in depth) — the magic-byte
    // allowlist above already excludes it (SVG is XML text, not one of the
    // three recognized binary signatures), but sharp is asked directly too
    // in case a future format is ever added to CATALOG_IMAGE_ALLOWED_MIME_TYPES
    // without this check being revisited.
    if (metadata.format === "svg") return { ok: false, error: "UNSUPPORTED_TYPE" };

    const rotatedMeta = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
    const sourceWidth = rotatedMeta.info.width;
    const sourceHeight = rotatedMeta.info.height;

    const dir = path.join(UPLOAD_ROOT, subdir);
    await mkdir(dir, { recursive: true });

    const urls: Record<ProcessedSizeKey, string> = { thumbnail: "", medium: "", main: "" };
    let mainSizeBytes = 0;
    for (const [key, dimension] of Object.entries(PROCESSED_IMAGE_SIZES) as [
      ProcessedSizeKey,
      number,
    ][]) {
      let quality = key === "thumbnail" ? 70 : 82;
      let encoded = await encodeSquareWebp(buffer, dimension, quality);
      // Spec: "Target approximately 500 KB or less for the main processed
      // image where reasonable without visibly damaging image quality" —
      // one re-encode at a lower quality if the first attempt overshoots;
      // never iterated further than that (a hard quality floor matters
      // more than hitting the target exactly).
      if (key === "main" && encoded.byteLength > MAIN_IMAGE_TARGET_BYTES) {
        quality = 65;
        const retry = await encodeSquareWebp(buffer, dimension, quality);
        if (retry.byteLength < encoded.byteLength) encoded = retry;
      }
      const filename = `${randomUUID()}-${key}.webp`;
      await writeFile(path.join(dir, filename), encoded);
      urls[key] = `${UPLOAD_URL_PREFIX}/${subdir}/${filename}`;
      if (key === "main") mainSizeBytes = encoded.byteLength;
    }

    return {
      ok: true,
      urls: {
        url: urls.main,
        thumbnailUrl: urls.thumbnail,
        mediumUrl: urls.medium,
        sourceWidth,
        sourceHeight,
        sizeBytes: mainSizeBytes,
        belowRecommendedSize:
          sourceWidth < MIN_RECOMMENDED_DIMENSION || sourceHeight < MIN_RECOMMENDED_DIMENSION,
      },
    };
  } catch {
    return { ok: false, error: "PROCESSING_FAILED" };
  }
}

/** Device-upload entry point into the shared pipeline. */
export async function processAndUploadCatalogImage(
  file: File,
  subdir: string,
): Promise<ProcessImageResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return processImageBuffer(buffer, file.type, CATALOG_IMAGE_MAX_BYTES, subdir);
}

/**
 * URL entry point into the shared pipeline — fetchImageFromUrl
 * (image-url-fetch.ts) does the SSRF-hardened retrieval; this just hands
 * the resulting bytes to the exact same processImageBuffer core a device
 * upload uses, so a pasted URL is validated (size/mime/signature) and
 * processed (resize/rotate/WebP) identically either way, and the source
 * is never hotlinked — only this platform-owned processed copy is ever
 * stored or served.
 */
export async function processAndUploadCatalogImageFromUrl(
  sourceUrl: string,
  subdir: string,
): Promise<ProcessImageResult | { ok: false; error: "FETCH_FAILED"; detail: string }> {
  const { fetchImageFromUrl } = await import("./image-url-fetch");
  const fetched = await fetchImageFromUrl(sourceUrl);
  if (!fetched.ok) return { ok: false, error: "FETCH_FAILED", detail: fetched.error };
  return processImageBuffer(fetched.buffer, fetched.contentType, CATALOG_IMAGE_MAX_BYTES, subdir);
}
