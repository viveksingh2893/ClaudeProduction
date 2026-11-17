import { NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import { getTrustedClientIp, requestOtp } from "@kisan4u/auth";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user?.phone) return jsonError(400, "PHONE_REQUIRED", "This account has no verified phone number.");
    const result = await requestOtp(user.phone, {
      purpose: "account_deletion",
      ip: getTrustedClientIp(req.headers),
    });
    if (!result.ok)
      return result.code === "RATE_LIMITED"
        ? jsonError(429, "RATE_LIMITED", result.error, { retryAfter: result.retryAfter })
        : jsonError(502, "SMS_SEND_FAILED", result.error);
    return jsonOk({ sent: true });
  });
}
