import { redirect } from "next/navigation";
import { hasModulePermission } from "@kisan4u/auth";
import { requireSession } from "./session-guard";

/** Same fail-open module-permission pattern as apps/dashboard/src/lib/pos-guard.ts — gates the admin Product Quantity page and its cross-seller stock actions. Missing/unset for an admin = allowed; explicit `false` = denied. */
export const INVENTORY_MODULE_KEY = "inventory";

/** Server-side gate — call from the admin Product Quantity page AND every admin inventory server action, never rely on the page having already checked. */
export async function requireInventoryAccess() {
  const session = await requireSession(["ADMIN"]);
  const allowed = await hasModulePermission(session.user.id, INVENTORY_MODULE_KEY);
  if (!allowed) redirect("/admin");
  return session;
}
