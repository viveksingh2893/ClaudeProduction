"use server";

import { revalidatePath } from "next/cache";
import {
  moderateReview,
  createManualReview,
  searchProductsForPicker,
  type ModerationDecision,
  type CreateManualReviewInput,
} from "@kisan4u/catalog";
import type { ReviewModerationStatus } from "@kisan4u/db";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function moderateReviewAction(
  reviewId: string,
  decision: ModerationDecision,
  note?: string,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await moderateReview(reviewId, decision, session.user.id, note);
  if (!result.ok) return result;
  revalidatePath("/admin/reviews");
  return { ok: true };
}

export type CreateManualReviewFormInput = {
  productId: string;
  customerDisplayName: string;
  rating: number;
  comment?: string;
  sourceReference?: string;
  consentConfirmed: boolean;
  moderationStatus: ReviewModerationStatus;
};

export async function createManualReviewAction(
  input: CreateManualReviewFormInput,
): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const payload: CreateManualReviewInput = input;
  const result = await createManualReview(payload, session.user.id);
  if (!result.ok) return result;
  revalidatePath("/admin/reviews");
  return { ok: true };
}

export async function searchProductsForReviewAction(query: string) {
  await requireSession(["ADMIN"]);
  return searchProductsForPicker(query);
}
