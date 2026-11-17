import { NextRequest } from "next/server";
import { getCheckoutGroupForCustomer } from "@kisan4u/orders";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Ownership-scoped — returns 404 (never another customer's group) if this checkout group doesn't belong to the caller. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req, ["CUSTOMER", "DEALER"]);
    const { groupId } = await params;
    const group = await getCheckoutGroupForCustomer(userId, groupId);
    if (!group) return jsonError(404, "NOT_FOUND", "Order not found.");
    return jsonOk({ group });
  });
}
