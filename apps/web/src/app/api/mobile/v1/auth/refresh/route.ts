import { NextRequest } from "next/server";
import {
  createMobileSessionTokenPair,
  mobileDeviceFromHeaders,
  rotateMobileSessionTokenPair,
  validateUserSession,
  verifyMobileRefreshToken,
} from "@kisan4u/auth";
import { refreshTokenSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, parseJsonBody, withMobileApi } from "@/lib/mobile-api";

/**
 * Rotates both tokens on every refresh (a used refresh token's replacement
 * is a brand new pair, not a reissue of the same refresh token) and
 * re-checks live account state via validateUserSession — the same
 * revocation check every protected website request makes — so a session
 * revoked by an admin (suspend, deactivate) cannot be silently extended
 * by refreshing.
 */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const body = await parseJsonBody(req);
    const parsed = refreshTokenSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Missing refresh token.");

    const verified = await verifyMobileRefreshToken(parsed.data.refreshToken);
    if (!verified)
      return jsonError(
        401,
        "TOKEN_INVALID",
        "Refresh token is invalid or expired. Please log in again.",
      );

    const session = await validateUserSession(
      verified.uid,
      verified.sessionVersion,
      verified.sessionId,
    );
    if (!session.valid) {
      return jsonError(
        401,
        "SESSION_INVALID",
        "Your session is no longer valid. Please log in again.",
      );
    }

    if (verified.legacy) {
      const tokens = await createMobileSessionTokenPair(
        {
          uid: verified.uid,
          role: verified.role,
          sessionVersion: verified.sessionVersion,
        },
        mobileDeviceFromHeaders(req.headers),
      );
      return jsonOk(tokens);
    }

    const rotated = await rotateMobileSessionTokenPair(verified);
    if (!rotated.ok) {
      return jsonError(
        401,
        rotated.reason === "REUSED" ? "REFRESH_TOKEN_REUSED" : "SESSION_INVALID",
        "This session may have been copied and has been revoked. Please log in again.",
      );
    }
    return jsonOk(rotated.tokens);
  });
}
