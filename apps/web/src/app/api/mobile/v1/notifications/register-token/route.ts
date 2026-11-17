import { NextRequest } from "next/server";
import { registerPushDevice } from "@kisan4u/orders";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileAuth,
  withMobileApi,
} from "@/lib/mobile-api";

type Body = { token?: unknown; platform?: unknown };

function readToken(body: unknown): { token: string; platform: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { token, platform } = body as Body;
  if (typeof token !== "string" || token.trim().length === 0) return null;
  return { token: token.trim(), platform: platform === "ios" ? "ios" : "android" };
}

/** The app calls this after login (and on token refresh) to register its Expo push token. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const parsed = readToken(await parseJsonBody(req));
    if (!parsed) return jsonError(400, "VALIDATION_ERROR", "A push token is required.");
    await registerPushDevice({ userId, pushToken: parsed.token, platform: parsed.platform });
    return jsonOk({ ok: true });
  });
}
