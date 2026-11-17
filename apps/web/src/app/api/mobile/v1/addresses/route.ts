import { NextRequest } from "next/server";
import { createAddress, listAddresses } from "@kisan4u/orders";
import { customerAddressInputSchema } from "@kisan4u/validators";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileBuyerContext,
  withMobileApi,
} from "@/lib/mobile-api";

export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const addresses = await listAddresses(buyer.userId);
    return jsonOk({ addresses });
  });
}

/** A dealer's state is always forced to their own verified state, never the submitted value — see createAddress's dealerLock param. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const buyer = await requireMobileBuyerContext(req);
    const body = await parseJsonBody(req);
    const parsed = customerAddressInputSchema.omit({ id: true }).safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid address.",
      );
    }

    const dealerLock = buyer.role === "DEALER" ? buyer.dealerState : null;
    const result = await createAddress(buyer.userId, dealerLock, parsed.data);
    if (!result.ok) return jsonError(400, "ADDRESS_ERROR", result.error);
    return jsonOk(result, 201);
  });
}
