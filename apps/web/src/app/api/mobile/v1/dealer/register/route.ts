import { NextRequest } from "next/server";
import {
  getVerifiedPhoneForOnboardingSession,
  consumeDealerOnboardingSession,
  registerDealer,
  createDealerStatusViewSession,
} from "@kisan4u/auth";
import { dealerRegistrationWithSessionSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, parseJsonBody, withMobileApi } from "@/lib/mobile-api";

/** Mirrors apps/web's submitDealerRegistrationAction. `phone` never comes from the client — it's resolved from the OTP-verified onboarding ticket. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const body = await parseJsonBody(req);
    const parsed = dealerRegistrationWithSessionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid registration details.",
      );
    }
    const { onboardingSessionId, ...input } = parsed.data;

    const phone = await getVerifiedPhoneForOnboardingSession(onboardingSessionId);
    if (!phone) {
      return jsonError(
        401,
        "SESSION_EXPIRED",
        "Your verification session has expired. Please start again.",
      );
    }

    const result = await registerDealer(phone, input);
    if (!result.ok) return jsonError(400, "REGISTRATION_ERROR", result.error);

    await consumeDealerOnboardingSession(onboardingSessionId);
    const statusViewSessionId = await createDealerStatusViewSession(result.dealerProfileId);

    return jsonOk({ dealerProfileId: result.dealerProfileId, statusViewSessionId }, 201);
  });
}
