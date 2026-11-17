import { redirect } from "next/navigation";
import { getDealerProfileForUser } from "@kisan4u/auth";
import { requireSession } from "./session-guard";

/**
 * Phase 4 addition — the "resolve session, require DEALER role, require
 * APPROVED profile" sequence was previously inlined ad hoc on every
 * dealer page/action (dealer/requests/actions.ts, dealer/products pages,
 * account/page.tsx). Consolidated here, mirroring
 * apps/dashboard/src/lib/require-approved-seller.ts's shape, so cart/
 * checkout/address code (and any future dealer page) shares one
 * implementation instead of a fifth copy.
 */
export async function requireApprovedDealerProfile() {
  const session = await requireSession(["DEALER"]);
  const profile = await getDealerProfileForUser(session.user.id);
  if (!profile) redirect("/login");
  if (profile.status !== "APPROVED") redirect("/dealer/status");
  return { session, profile };
}
