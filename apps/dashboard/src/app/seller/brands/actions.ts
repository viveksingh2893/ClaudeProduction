"use server";

import { brandInputSchema } from "@kisan4u/validators";
import {
  createBrandRequest,
  updateBrandRequest,
  assertSellerOwnsEditableBrand,
} from "@kisan4u/catalog";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

type Result = { ok: true } | { ok: false; error: string };

export async function createBrandRequestAction(input: {
  name: string;
  slug: string;
  imageUrl?: string;
}): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const parsed = brandInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return createBrandRequest(sellerProfileId, parsed.data);
}

export async function updateBrandRequestAction(
  id: string,
  input: { name: string; slug: string; imageUrl?: string },
): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  const owns = await assertSellerOwnsEditableBrand(sellerProfileId, id);
  if (!owns.ok) return owns;
  const parsed = brandInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return updateBrandRequest(id, parsed.data);
}
