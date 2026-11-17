import { NextRequest } from "next/server";
import { revokeMobileSession } from "@kisan4u/auth";
import { jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const auth = await requireMobileAuth(req);
    if (auth.sessionId) {
      await revokeMobileSession(auth.userId, auth.sessionId, "LOGOUT");
    }
    return jsonOk({ revoked: Boolean(auth.sessionId) });
  });
}
