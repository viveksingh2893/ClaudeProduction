import { NextRequest } from "next/server";
import { removeCartItem, updateCartItemQuantity } from "@kisan4u/orders";
import { updateCartItemQuantityInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { itemId } = await params;
    const body = await parseJsonBody(req);
    const parsed = updateCartItemQuantityInputSchema.safeParse({
      ...(body as object),
      cartItemId: itemId,
    });
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    }

    const result = await updateCartItemQuantity(
      buyer.userId,
      { role: buyer.role, dealerStateId: buyer.dealerState?.id ?? null },
      parsed.data,
    );
    if (!result.ok) return jsonError(400, "CART_ERROR", result.error);
    return jsonOk(result);
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { itemId } = await params;
    const result = await removeCartItem(buyer.userId, itemId);
    if (!result.ok) return jsonError(404, "NOT_FOUND", result.error);
    return jsonOk(result);
  });
}
