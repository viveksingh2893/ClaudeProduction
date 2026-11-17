"use server";

import { updateRequestStatusAsSeller } from "@kisan4u/catalog";
import { requireApprovedSeller } from "@/lib/require-approved-seller";

type Result = { ok: true } | { ok: false; error: string };

export async function updateRequestStatusAction(
  requestId: string,
  status: "VIEWED" | "RESPONDED" | "CLOSED",
): Promise<Result> {
  const { sellerProfileId } = await requireApprovedSeller();
  return updateRequestStatusAsSeller(sellerProfileId, requestId, status);
}
