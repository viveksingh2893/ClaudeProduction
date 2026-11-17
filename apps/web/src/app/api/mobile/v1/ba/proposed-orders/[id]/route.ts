import { NextRequest } from "next/server";
import {
  getProductImageUrls,
  getProposedOrderForViewer,
  decideProposedOrder,
} from "@kisan4u/orders";
import { proposedOrderDecisionSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const { id } = await ctx.params;
    const po = await getProposedOrderForViewer(id, userId);
    if (!po) return jsonError(404, "NOT_FOUND", "Order not found.");
    const imageUrls = await getProductImageUrls(po.items.map((item) => item.productId));
    const baName = [po.ba.firstName, po.ba.lastName].filter(Boolean).join(" ") || "Business Associate";
    const refereeName =
      [po.refereeUser.firstName, po.refereeUser.lastName].filter(Boolean).join(" ") ||
      po.refereeUser.phone ||
      "Customer";
    return jsonOk({
      id: po.id,
      status: po.status,
      grandTotal: Number(po.grandTotal),
      addressSnapshot: po.addressSnapshot,
      items: po.items.map((i) => ({
        productName: i.productName,
        variantLabel: i.variantLabel,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
        imageUrl: imageUrls.get(i.productId) ?? null,
      })),
      isReferee: po.refereeUserId === userId,
      baName,
      refereeName,
      refereePhone: po.refereeUser.phone,
    });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const { id } = await ctx.params;
    const body = await req.json();
    const parsed = proposedOrderDecisionSchema.safeParse({ ...body, proposedOrderId: id });
    if (!parsed.success) {
      return jsonError(400, "INVALID", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const res = await decideProposedOrder(userId, id, parsed.data.decision);
    if (!res.ok) return jsonError(400, "REJECTED", res.error);
    return jsonOk({ checkoutGroupId: res.checkoutGroupId ?? null });
  });
}
