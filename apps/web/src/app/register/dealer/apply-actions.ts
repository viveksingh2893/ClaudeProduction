"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { submitDealerApplicationForUser } from "@kisan4u/auth";
import { dealerApplicationSchema } from "@kisan4u/validators";
import type { DealerApplicationInput } from "@kisan4u/validators";

type SubmitResult =
  | { ok: true; resubmitted: boolean }
  | { ok: false; error: string };

/**
 * "Become a Dealer" for a signed-in customer (the web mirror of
 * POST /api/mobile/v1/dealer/apply). Unlike submitDealerRegistrationAction
 * — which is the signed-out, OTP-onboarding path — the account already
 * exists and is already phone-verified, so there is no onboarding ticket:
 * the target user is the session user, full stop. A pending / rejected
 * application is edited and resubmitted through this same action.
 * The user's role stays CUSTOMER until an admin approves.
 */
export async function submitDealerApplicationAction(
  input: DealerApplicationInput,
): Promise<SubmitResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Please log in to apply." };
  }
  if (session.user.role !== "CUSTOMER") {
    return { ok: false, error: "This account can't apply to become a dealer." };
  }

  const parsed = dealerApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await submitDealerApplicationForUser(session.user.id, parsed.data, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  // Refresh the storefront chrome (promo ribbon / footer CTA now reads
  // "Dealer application: Pending") and this page.
  revalidatePath("/", "layout");
  return { ok: true, resubmitted: result.data.resubmitted };
}
