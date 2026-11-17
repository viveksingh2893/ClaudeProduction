"use server";

import { revalidatePath } from "next/cache";
import {
  listBulkDrafts,
  createBulkDraft,
  renameBulkDraft,
  deleteBulkDraft,
  duplicateBulkDraft,
  getBulkDraft,
  upsertBulkGroup,
  deleteBulkGroup,
  upsertBulkRow,
  deleteBulkRow,
  loadExistingProductForBulkRecall,
  submitBulkDraft,
  validateBulkDraft,
  type BulkActor,
} from "@kisan4u/catalog";
import type { BulkGroupSharedDataInput, BulkRowDataInput } from "@kisan4u/validators";
import { processAndUploadCatalogImage, processAndUploadCatalogImageFromUrl } from "@kisan4u/providers";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

async function sellerActor(): Promise<BulkActor> {
  const { session, sellerProfileId } = await requireApprovedSeller();
  return { role: "SELLER", userId: session.user.id, sellerId: sellerProfileId };
}

export async function listBulkDraftsAction() {
  return listBulkDrafts(await sellerActor());
}

export async function createBulkDraftAction(name: string) {
  return createBulkDraft(await sellerActor(), name);
}

export async function renameBulkDraftAction(draftId: string, name: string) {
  const result = await renameBulkDraft(await sellerActor(), draftId, name);
  revalidatePath("/seller/bulk-products");
  return result;
}

export async function deleteBulkDraftAction(draftId: string) {
  const result = await deleteBulkDraft(await sellerActor(), draftId);
  revalidatePath("/seller/bulk-products");
  return result;
}

export async function duplicateBulkDraftAction(draftId: string) {
  const result = await duplicateBulkDraft(await sellerActor(), draftId);
  revalidatePath("/seller/bulk-products");
  return result;
}

export async function getBulkDraftAction(draftId: string) {
  return getBulkDraft(await sellerActor(), draftId);
}

export async function upsertBulkGroupAction(
  draftId: string,
  expectedVersion: number,
  input: {
    groupId?: string;
    groupKey: string;
    hasVariants: boolean;
    audience: "CUSTOMER_ONLY" | "DEALER_ONLY" | "BOTH_CUSTOMER_AND_DEALER" | null;
    sharedData: BulkGroupSharedDataInput;
  },
) {
  return upsertBulkGroup(await sellerActor(), draftId, expectedVersion, input);
}

export async function deleteBulkGroupAction(draftId: string, expectedVersion: number, groupId: string) {
  return deleteBulkGroup(await sellerActor(), draftId, expectedVersion, groupId);
}

export async function upsertBulkRowAction(
  draftId: string,
  expectedVersion: number,
  input: {
    rowId?: string;
    groupId: string;
    audience: "CUSTOMER" | "DEALER";
    rowData: BulkRowDataInput;
    existingVariantId?: string | null;
  },
) {
  return upsertBulkRow(await sellerActor(), draftId, expectedVersion, input);
}

export async function deleteBulkRowAction(draftId: string, expectedVersion: number, rowId: string) {
  return deleteBulkRow(await sellerActor(), draftId, expectedVersion, rowId);
}

export async function loadExistingProductForRecallAction(productId: string) {
  return loadExistingProductForBulkRecall(await sellerActor(), productId);
}

export async function validateBulkDraftAction(draftId: string) {
  return validateBulkDraft(await sellerActor(), draftId);
}

export async function submitBulkDraftAction(draftId: string) {
  const result = await submitBulkDraft(await sellerActor(), draftId);
  revalidatePath("/seller/products");
  revalidatePath("/seller/bulk-products");
  return result;
}

/** Bulk-grid image cell — device upload, routed through the sharp processing pipeline. Folder is keyed by draftId+groupKey (not a real productId, which may not exist yet), matching the pending-id pattern the single-product form already uses for pre-save uploads. */
export async function uploadBulkImageAction(draftId: string, groupKey: string, file: File) {
  await requireApprovedSeller();
  const result = await processAndUploadCatalogImage(file, `bulk-drafts/${draftId}/${groupKey}`);
  return result;
}

export async function uploadBulkImageFromUrlAction(draftId: string, groupKey: string, url: string) {
  await requireApprovedSeller();
  const result = await processAndUploadCatalogImageFromUrl(url, `bulk-drafts/${draftId}/${groupKey}`);
  return result;
}
