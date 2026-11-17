import { NextRequest } from "next/server";
import { listCheckoutGroupsForCustomer } from "@kisan4u/orders";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Order history — grouped by checkout (multi-seller order splitting is visible here: one checkout can list several seller orders sharing a group). */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req, ["CUSTOMER", "DEALER"]);
    const groups = await listCheckoutGroupsForCustomer(userId);
    return jsonOk({ groups });
  });
}
