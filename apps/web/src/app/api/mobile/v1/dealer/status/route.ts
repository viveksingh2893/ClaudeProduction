import { NextRequest } from "next/server";
import { getDealerProfileForUser, getDealerProfileForStatusViewSession } from "@kisan4u/auth";
import { jsonError, jsonOk, optionalMobileAuth, withMobileApi } from "@/lib/mobile-api";

/**
 * Dealer application status. Two ways in, matching the website's two
 * different visitors:
 *  - a just-registered dealer with no session yet: `?statusViewSessionId=`
 *    (the ticket returned by POST /dealer/register — see
 *    packages/auth/src/onboarding.ts for its TTL/consumption semantics).
 *  - a dealer who has since logged in (e.g. checking status again later):
 *    a normal bearer token.
 */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const url = new URL(req.url);
    const statusViewSessionId = url.searchParams.get("statusViewSessionId");

    if (statusViewSessionId) {
      const profile = await getDealerProfileForStatusViewSession(statusViewSessionId);
      if (!profile) return jsonError(404, "NOT_FOUND", "Status link expired. Please log in instead.");
      return jsonOk({ profile });
    }

    const auth = await optionalMobileAuth(req);
    if (!auth || auth.role !== "DEALER") {
      return jsonError(401, "UNAUTHENTICATED", "Log in or provide a statusViewSessionId.");
    }
    const profile = await getDealerProfileForUser(auth.userId);
    if (!profile) return jsonError(404, "NOT_FOUND", "Dealer profile not found.");
    return jsonOk({ profile });
  });
}
