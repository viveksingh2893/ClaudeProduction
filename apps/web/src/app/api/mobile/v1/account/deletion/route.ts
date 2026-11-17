import { NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import { getTrustedClientIp, verifyOtp } from "@kisan4u/auth";
import {
  finalizeAccountDeletion,
  getAccountDeletionEligibility,
  requestAccountDeletion,
} from "@kisan4u/orders";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireMobileAuth,
  withMobileApi,
} from "@/lib/mobile-api";

export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const [eligibility, request] = await Promise.all([
      getAccountDeletionEligibility(userId),
      prisma.accountDeletionRequest.findFirst({
        where: { userId },
        orderBy: { requestedAt: "desc" },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          scheduledFor: true,
          completedAt: true,
        },
      }),
    ]);
    if (!eligibility) return jsonError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    return jsonOk({ eligibility, request });
  });
}

export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const body = (await parseJsonBody(req)) as {
      code?: unknown;
      reason?: unknown;
      immediate?: unknown;
      forfeitWalletBalance?: unknown;
    };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) return jsonError(400, "VALIDATION_ERROR", "Enter the 6-digit OTP.");

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user?.phone)
      return jsonError(400, "PHONE_REQUIRED", "This account has no verified phone number.");
    const verified = await verifyOtp(user.phone, code, {
      purpose: "account_deletion",
      ip: getTrustedClientIp(req.headers),
    });
    if (!verified.ok)
      return verified.code === "RATE_LIMITED"
        ? jsonError(429, "RATE_LIMITED", "Too many incorrect codes. Please wait.", {
            retryAfter: verified.retryAfter,
          })
        : jsonError(400, "OTP_VERIFY_FAILED", "Invalid or expired OTP.");

    const immediate = body.immediate === true;
    const result = await requestAccountDeletion({
      userId,
      immediate,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      forfeitWalletBalance: body.forfeitWalletBalance === true,
    });
    if (!result.ok) {
      return jsonError(
        409,
        "DELETION_BLOCKED",
        result.error,
        "eligibility" in result ? { eligibility: result.eligibility } : undefined,
      );
    }
    if (immediate && result.request.status === "SCHEDULED") {
      const finalized = await finalizeAccountDeletion(userId);
      if (!finalized.ok)
        return jsonError(409, "DELETION_BLOCKED", finalized.error ?? "Deletion is blocked.");
    }
    return jsonOk({
      request: result.request,
      completed: immediate && result.request.status === "SCHEDULED",
    });
  });
}
