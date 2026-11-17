import { NextRequest } from "next/server";
import { unregisterPushDevice } from "@kisan4u/orders";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileAuth,
  withMobileApi,
} from "@/lib/mobile-api";

/** Called on logout so this device stops receiving pushes for the account that was signed in. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const body = await parseJsonBody(req);
    const token =
      typeof body === "object" && body !== null && typeof (body as { token?: unknown }).token === "string"
        ? ((body as { token: string }).token).trim()
        : "";
    if (!token) return jsonError(400, "VALIDATION_ERROR", "A push token is required.");
    await unregisterPushDevice({ userId, pushToken: token });
    return jsonOk({ ok: true });
  });
}
