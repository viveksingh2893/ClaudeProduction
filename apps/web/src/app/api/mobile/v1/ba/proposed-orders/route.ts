import { NextRequest } from "next/server";
import { createProposedOrder } from "@kisan4u/orders";
import { proposedOrderCreateSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Create a proposed order on behalf of a referred customer — mirrors createProposedOrderAction (apps/web/src/app/account/ba/actions.ts). */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const body = await req.json();
    const parsed = proposedOrderCreateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "INVALID", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const res = await createProposedOrder(userId, parsed.data);
    if (!res.ok) return jsonError(400, "REJECTED", res.error);
    return jsonOk({ proposedOrderId: res.proposedOrderId });
  });
}
