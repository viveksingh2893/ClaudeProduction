"use server";

import { manufacturerInputSchema } from "@kisan4u/validators";
import {
  createManufacturerRequest,
  updateManufacturerRequest,
  assertSellerOwnsEditableManufacturer,
} from "@kisan4u/catalog";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

type Result = { ok: true } | { ok: false; error: string };

export async function createManufacturerRequestAction(input: {
  name: string;
  slug: string;
  imageUrl?: string;
}): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const parsed = manufacturerInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return createManufacturerRequest(sellerProfileId, parsed.data);
}

export async function updateManufacturerRequestAction(
  id: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const owns = await assertSellerOwnsEditableManufacturer(sellerProfileId, id);
  if (!owns.ok) return owns;
  const parsed = manufacturerInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return updateManufacturerRequest(id, parsed.data);
}
