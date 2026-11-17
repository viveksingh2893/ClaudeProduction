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
import { requireSession } from "@/lib/session-guard";

async function adminActor(): Promise<BulkActor> {
  const session = await requireSession(["ADMIN"]);
  return { role: "ADMIN", userId: session.user.id };
}

export async function listBulkDraftsAction() {
  return listBulkDrafts(await adminActor());
}

export async function createBulkDraftAction(name: string) {
  return createBulkDraft(await adminActor(), name);
}

export async function renameBulkDraftAction(draftId: string, name: string) {
  const result = await renameBulkDraft(await adminActor(), draftId, name);
  revalidatePath("/admin/bulk-products");
  return result;
}

export async function deleteBulkDraftAction(draftId: string) {
  const result = await deleteBulkDraft(await adminActor(), draftId);
  revalidatePath("/admin/bulk-products");
  return result;
}

export async function duplicateBulkDraftAction(draftId: string) {
  const result = await duplicateBulkDraft(await adminActor(), draftId);
  revalidatePath("/admin/bulk-products");
  return result;
}

export async function getBulkDraftAction(draftId: string) {
  return getBulkDraft(await adminActor(), draftId);
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
    sellerId?: string | null;
  },
) {
  return upsertBulkGroup(await adminActor(), draftId, expectedVersion, input);
}

export async function deleteBulkGroupAction(draftId: string, expectedVersion: number, groupId: string) {
  return deleteBulkGroup(await adminActor(), draftId, expectedVersion, groupId);
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
  return upsertBulkRow(await adminActor(), draftId, expectedVersion, input);
}

export async function deleteBulkRowAction(draftId: string, expectedVersion: number, rowId: string) {
  return deleteBulkRow(await adminActor(), draftId, expectedVersion, rowId);
}

export async function loadExistingProductForRecallAction(productId: string) {
  return loadExistingProductForBulkRecall(await adminActor(), productId);
}

export async function validateBulkDraftAction(draftId: string) {
  return validateBulkDraft(await adminActor(), draftId);
}

export async function submitBulkDraftAction(draftId: string) {
  const result = await submitBulkDraft(await adminActor(), draftId);
  revalidatePath("/admin/products");
  revalidatePath("/admin/bulk-products");
  return result;
}

export async function uploadBulkImageAction(draftId: string, groupKey: string, file: File) {
  await requireSession(["ADMIN"]);
  return processAndUploadCatalogImage(file, `bulk-drafts/${draftId}/${groupKey}`);
}

export async function uploadBulkImageFromUrlAction(draftId: string, groupKey: string, url: string) {
  await requireSession(["ADMIN"]);
  return processAndUploadCatalogImageFromUrl(url, `bulk-drafts/${draftId}/${groupKey}`);
}
