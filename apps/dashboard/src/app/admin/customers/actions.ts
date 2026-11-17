"use server";

import { revalidatePath } from "next/cache";
import { hasModulePermission } from "@kisan4u/auth";
import { adminChangeCustomerState, type CustomerStateResult } from "@kisan4u/catalog";
import { requireSession } from "@/lib/session-guard";

/**
 * Same fail-open-by-default module-permission convention as
 * apps/dashboard/src/lib/pos-guard.ts's POS_MODULE_KEY — an admin with no
 * AdminProfile row, or no "customers" key set, is allowed (requireSession
 * ADMIN is the real gate); only an explicit `modulePermissions.customers
 * = false` denies it. Spec: "Do not allow customer-support or
 * unauthorized roles to change the state unless their existing
 * permissions explicitly allow customer editing" — this is the "existing
 * permissions" mechanism referred to.
 */
const CUSTOMER_MODULE_KEY = "customers";

/**
 * Admin-only, module-permission-gated change to an already-set customer
 * state — spec §1's "Change customer state" action. Unlike the customer's
 * own one-time self-service action, this is intentionally repeatable and
 * always requires a reason + writes a full audit entry (see
 * adminChangeCustomerState in packages/catalog).
 */
export async function adminChangeCustomerStateAction(
  targetUserId: string,
  newStateId: string,
  reason: string,
): Promise<CustomerStateResult> {
  const session = await requireSession(["ADMIN"]);
  const allowed = await hasModulePermission(session.user.id, CUSTOMER_MODULE_KEY);
  if (!allowed) return { ok: false, error: "You do not have permission to change customer state." };

  const result = await adminChangeCustomerState(targetUserId, newStateId, reason, {
    id: session.user.id,
  });
  if (result.ok) {
    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${targetUserId}`);
  }
  return result;
}
