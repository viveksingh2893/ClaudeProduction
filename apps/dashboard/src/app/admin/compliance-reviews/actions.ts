"use server";

import { revalidatePath } from "next/cache";
import {
  resolveComplianceReview,
  sweepExpiredLicenceSubmissions,
  sendLicenceExpiryReminders,
} from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

export async function resolveComplianceReviewAction(id: string): Promise<Result> {
  const session = await requireSession(["ADMIN"]);
  const result = await resolveComplianceReview(id, { id: session.user.id });
  if (!result.ok) return result;
  revalidatePath("/admin/compliance-reviews");
  return { ok: true };
}

/**
 * Manual trigger for the lazy expiry sweep — this codebase has no
 * scheduler (see packages/catalog/src/licence-compliance.ts's doc
 * comment), so an admin visiting this page is also a natural, safe point
 * to run it eagerly rather than waiting for the next incidental read.
 */
export async function runExpirySweepAction(): Promise<{
  ok: true;
  expired: number;
  remindersSent: number;
}> {
  await requireSession(["ADMIN"]);
  const [expired, remindersSent] = await Promise.all([
    sweepExpiredLicenceSubmissions(),
    sendLicenceExpiryReminders(),
  ]);
  revalidatePath("/admin/compliance-reviews");
  return { ok: true, expired, remindersSent };
}
