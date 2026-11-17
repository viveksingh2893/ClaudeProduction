import { NextRequest } from "next/server";
import { deleteAddress, updateAddress } from "@kisan4u/orders";
import { customerAddressInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { id } = await params;
    const body = await parseJsonBody(req);
    const parsed = customerAddressInputSchema.safeParse({ ...(body as object), id });
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid address.",
      );
    }

    const dealerLock = buyer.role === "DEALER" ? buyer.dealerState : null;
    const result = await updateAddress(buyer.userId, dealerLock, parsed.data);
    if (!result.ok) return jsonError(400, "ADDRESS_ERROR", result.error);
    return jsonOk(result);
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const { id } = await params;
    const result = await deleteAddress(buyer.userId, id);
    if (!result.ok) return jsonError(400, "ADDRESS_ERROR", result.error);
    return jsonOk(result);
  });
}
