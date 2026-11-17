import { NextRequest } from "next/server";
import {
  createMobileSessionTokenPair,
  mobileDeviceFromHeaders,
  verifyPasswordLogin,
} from "@kisan4u/auth";
import { passwordLoginSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, parseJsonBody, withMobileApi } from "@/lib/mobile-api";

/** Email+password login for SELLER (and ADMIN, for support/testing access) — same account universe as apps/dashboard's login. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const body = await parseJsonBody(req);
    const parsed = passwordLoginSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid email or password.",
      );
    }

    const result = await verifyPasswordLogin(parsed.data.email, parsed.data.password);
    if (!result.ok) return jsonError(401, "LOGIN_FAILED", result.error);

    const tokens = await createMobileSessionTokenPair(
      {
        uid: result.user.id,
        role: result.user.role,
        sessionVersion: result.user.sessionVersion,
      },
      mobileDeviceFromHeaders(req.headers),
    );

    return jsonOk({
      ...tokens,
      user: {
        id: result.user.id,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
      },
    });
  });
}
