"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getVerifiedPhoneForOnboardingSession,
  consumeDealerOnboardingSession,
  registerDealer,
  createDealerStatusViewSession,
} from "@kisan4u/auth";
import type { DealerRegistrationInput } from "@kisan4u/validators";
import { DEALER_ONBOARDING_COOKIE } from "../onboarding-cookie";
import {
  DEALER_STATUS_VIEW_COOKIE,
  DEALER_STATUS_VIEW_MAX_AGE_SECONDS,
} from "@/app/dealer/status-view-cookie";

type SubmitResult = { ok: false; error: string };

/**
 * On success this redirects straight to /dealer/status instead of
 * returning a value — Next.js's redirect() thrown from a Server Action
 * propagates directly to client-side navigation, so the caller (see
 * ./details-form.tsx) only ever sees this function "return" on the error
 * path. No auto-login through the normal NextAuth flow (that architecture
 * has no way to grant a session from inside a Server Action), but a
 * short-lived DealerStatusViewSession cookie lets the pending-status page
 * render for this exact dealer without forcing a fresh login.
 */
export async function submitDealerRegistrationAction(
  input: DealerRegistrationInput,
): Promise<SubmitResult> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(DEALER_ONBOARDING_COOKIE)?.value;
  if (!sessionId) {
    return { ok: false, error: "Your verification session has expired. Please start again." };
  }

  // The phone this registration is FOR comes from the server-side
  // onboarding ticket, resolved fresh here — `input` has no phone field
  // at all (see packages/validators/src/registration.ts), so there is
  // nothing for a modified/replayed client request to override.
  const phone = await getVerifiedPhoneForOnboardingSession(sessionId);
  if (!phone) {
    return { ok: false, error: "Your verification session has expired. Please start again." };
  }

  const result = await registerDealer(phone, input);
  if (!result.ok) return result;

  // One-time: this ticket can't be replayed to create a second profile.
  await consumeDealerOnboardingSession(sessionId);
  cookieStore.delete(DEALER_ONBOARDING_COOKIE);

  const statusViewSessionId = await createDealerStatusViewSession(result.dealerProfileId);
  cookieStore.set(DEALER_STATUS_VIEW_COOKIE, statusViewSessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/dealer",
    maxAge: DEALER_STATUS_VIEW_MAX_AGE_SECONDS,
  });

  redirect("/dealer/status");
}
