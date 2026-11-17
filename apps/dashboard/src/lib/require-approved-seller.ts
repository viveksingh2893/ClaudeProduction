import { redirect } from "next/navigation";
import { getSellerProfileForUser } from "@kisan4u/auth";
import { requireSession } from "./session-guard";

/**
 * The gate every seller product page/action must go through — only
 * APPROVED, active sellers may manage products (see
 * apps/dashboard/src/app/seller/page.tsx for the same pattern applied to
 * the seller dashboard landing page). Redirects to /seller/status for any
 * other application state instead of rendering a product page a
 * pending/rejected/suspended seller shouldn't reach.
 */
export async function requireApprovedSeller() {
  const session = await requireSession(["SELLER"]);
  const profile = await getSellerProfileForUser(session.user.id);
  if (!profile) {
    redirect("/login");
  }
  if (profile.status !== "APPROVED") {
    redirect("/seller/status");
  }
  return { session, sellerProfileId: profile.id };
}
