/**
 * Upload-security coverage for the selling-licence module's private
 * document storage — pure function, no filesystem writes needed for the
 * validation checks themselves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePrivateDocument,
  isPrivateDocumentStorageKey,
  isPrivateKycUploadSubpath,
  detectFileType,
  validatePrivateDocumentContent,
  resolvePrivateDocumentPath,
  PRIVATE_DOCUMENT_MAX_BYTES,
  validateCatalogImage,
  validateCatalogImageBytes,
  catalogImagePaths,
  CATALOG_IMAGE_MAX_BYTES,
} from "./storage";

function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as unknown as File;
}

test("rejects a file over the size limit", () => {
  const file = fakeFile("licence.pdf", "application/pdf", PRIVATE_DOCUMENT_MAX_BYTES + 1);
  assert.equal(validatePrivateDocument(file), "FILE_TOO_LARGE");
});

test("accepts a file exactly at the size limit", () => {
  const file = fakeFile("licence.pdf", "application/pdf", PRIVATE_DOCUMENT_MAX_BYTES);
  assert.equal(validatePrivateDocument(file), null);
});

test("rejects an unsupported MIME type (e.g. an executable)", () => {
  const file = fakeFile("licence.exe", "application/x-msdownload", 1000);
  assert.equal(validatePrivateDocument(file), "UNSUPPORTED_TYPE");
});

for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
  test(`accepts allowed MIME type ${type}`, () => {
    const file = fakeFile("licence", type, 1000);
    assert.equal(validatePrivateDocument(file), null);
  });
}

test("resolvePrivateDocumentPath rejects a path-traversal attempt", () => {
  assert.equal(resolvePrivateDocumentPath("../../etc/passwd"), null);
  assert.equal(resolvePrivateDocumentPath("seller-selling-licences/../../secret"), null);
});

test("private document keys are opaque relative paths", () => {
  assert.equal(isPrivateDocumentStorageKey("dealer-documents/abc-123.pdf"), true);
  assert.equal(isPrivateDocumentStorageKey("ba-documents/abc-123.webp"), true);
  assert.equal(isPrivateDocumentStorageKey("seller-selling-licences/legacy-key"), true);
  assert.equal(isPrivateDocumentStorageKey("/api/uploads/dealer-documents/abc.pdf"), false);
  assert.equal(isPrivateDocumentStorageKey("C:\\secret\\document.pdf"), false);
  assert.equal(isPrivateDocumentStorageKey("dealer-documents/../../secret.pdf"), false);
});

test("the public upload route classifies every KYC folder as private", () => {
  assert.equal(isPrivateKycUploadSubpath(["dealer-documents", "x.pdf"]), true);
  assert.equal(isPrivateKycUploadSubpath(["ba-documents", "x.pdf"]), true);
  assert.equal(isPrivateKycUploadSubpath(["seller-documents", "x.pdf"]), true);
  assert.equal(isPrivateKycUploadSubpath(["product-images", "x.webp"]), false);
});

test("detectFileType recognizes supported document and media signatures", () => {
  assert.equal(
    detectFileType(new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF"))?.mimeType,
    "application/pdf",
  );
  assert.equal(detectFileType(new Uint8Array(JPEG_HEADER))?.extension, ".jpg");
  assert.equal(detectFileType(new Uint8Array(PNG_HEADER))?.extension, ".png");
  assert.equal(detectFileType(new Uint8Array(WEBP_HEADER))?.extension, ".webp");
  assert.equal(detectFileType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))?.extension, ".webm");
});

test("private document validation rejects renamed content and active PDF actions", async () => {
  const renamed = realFile(PNG_HEADER, "document.pdf", "application/pdf");
  assert.equal(await validatePrivateDocumentContent(renamed), "CONTENT_MISMATCH");
  const unsafePdf = new File(["%PDF-1.7\n/OpenAction 1 0 R\n%%EOF"], "document.pdf", {
    type: "application/pdf",
  });
  assert.equal(await validatePrivateDocumentContent(unsafePdf), "UNSAFE_PDF");
});

test("private document validation trusts detected bytes rather than a browser MIME claim", async () => {
  const png = realFile(PNG_HEADER, "document.png", "application/octet-stream");
  assert.equal(await validatePrivateDocumentContent(png), null);
});

test("resolvePrivateDocumentPath resolves a well-formed storage key to a path under the private root", () => {
  const resolved = resolvePrivateDocumentPath("seller-selling-licences/seller1/req1/abc123.pdf");
  assert.ok(resolved);
  assert.ok(
    resolved!.includes("private-licences") || process.env.PRIVATE_LICENCE_UPLOAD_ROOT,
    "resolves under the dedicated private root, not the public uploads tree",
  );
  assert.ok(!resolved!.includes(".."));
});

// --- Catalog/product image validation -------------------------------------

function realFile(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0, 0, "J".charCodeAt(0), "F".charCodeAt(0)];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

test("validateCatalogImage rejects a file over the size limit", () => {
  const file = fakeFile("photo.jpg", "image/jpeg", CATALOG_IMAGE_MAX_BYTES + 1);
  assert.equal(validateCatalogImage(file), "FILE_TOO_LARGE");
});

test("validateCatalogImage rejects a non-image MIME type (e.g. PDF, since image uploads don't allow documents)", () => {
  const file = fakeFile("photo.pdf", "application/pdf", 1000);
  assert.equal(validateCatalogImage(file), "UNSUPPORTED_TYPE");
});

test("validateCatalogImageBytes accepts a genuine JPEG", async () => {
  const file = realFile(JPEG_HEADER, "photo.jpg", "image/jpeg");
  assert.equal(await validateCatalogImageBytes(file), null);
});

test("validateCatalogImageBytes accepts a genuine PNG", async () => {
  const file = realFile(PNG_HEADER, "photo.png", "image/png");
  assert.equal(await validateCatalogImageBytes(file), null);
});

test("validateCatalogImageBytes accepts a genuine WEBP", async () => {
  const file = realFile(WEBP_HEADER, "photo.webp", "image/webp");
  assert.equal(await validateCatalogImageBytes(file), null);
});

test("validateCatalogImageBytes rejects a file whose declared type doesn't match its actual bytes (renamed executable)", async () => {
  const file = realFile([0x4d, 0x5a, 0x90, 0x00], "photo.jpg", "image/jpeg"); // MZ = Windows PE header
  assert.equal(await validateCatalogImageBytes(file), "SIGNATURE_MISMATCH");
});

test("catalogImagePaths builds the exact required folder hierarchy, keyed by immutable id with a readable slug suffix", () => {
  assert.equal(
    catalogImagePaths.category("cat123", "Fresh Vegetables"),
    "catalog-images/categories/cat123-fresh-vegetables",
  );
  assert.equal(
    catalogImagePaths.subcategory("sub456", "Root Veg"),
    "catalog-images/subcategories/sub456-root-veg",
  );
  assert.equal(
    catalogImagePaths.subSubcategory("subsub789", "Carrots"),
    "catalog-images/sub-subcategories/subsub789-carrots",
  );
  assert.equal(
    catalogImagePaths.brand("brand1", "AgriPure"),
    "catalog-images/brands/brand1-agripure",
  );
  assert.equal(
    catalogImagePaths.manufacturer("manu1", "Kisan4U Mfg"),
    "catalog-images/manufacturers/manu1-kisan4u-mfg",
  );
  assert.equal(
    catalogImagePaths.productBase("seller1", "prod1", "Organic Seeds"),
    "product-images/sellers/seller1/prod1-organic-seeds/base",
  );
  assert.equal(
    catalogImagePaths.productVariant("seller1", "prod1", "Organic Seeds", "var1", "500g Pack"),
    "product-images/sellers/seller1/prod1-organic-seeds/variants/var1-500g-pack",
  );
});

test("catalogImagePaths sanitizes an unsafe slug (path-traversal/special characters) rather than embedding it raw", () => {
  const built = catalogImagePaths.category("cat123", "../../etc/passwd");
  assert.ok(!built.includes(".."));
  assert.ok(!built.includes("/etc/"));
});
