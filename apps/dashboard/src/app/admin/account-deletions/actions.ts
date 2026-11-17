"use server";

import { revalidatePath } from "next/cache";
import { reviewAccountDeletionRequest } from "@kisan4u/orders";
import { requireAdminPermission } from "@/lib/session-guard";
import { ACCOUNT_DELETION_MODULE_KEY } from "@/lib/account-deletion-guard";

export async function reviewDeletionAction(formData: FormData) {
  const session = await requireAdminPermission(ACCOUNT_DELETION_MODULE_KEY, "DELETE");
  const requestId = String(formData.get("requestId") ?? "");
  const decision = formData.get("decision") === "APPROVE" ? "APPROVE" : "CANCEL";
  await reviewAccountDeletionRequest({ requestId, actorId: session.user.id, decision });
  revalidatePath("/admin/account-deletions");
}
