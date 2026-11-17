import { NextRequest } from "next/server";
import {
  getDealerApplicationForUser,
  submitDealerApplicationForUser,
  getUserBasicInfo,
} from "@kisan4u/auth";
import { dealerApplicationSchema } from "@kisan4u/validators";
import { jsonError, jsonOk, parseJsonBody, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/**
 * "Become a Dealer" for a signed-in customer — the app mirror of the web
 * flow at apps/web/src/app/register/dealer. Unlike POST /dealer/register
 * (brand-new phone, no account), this attaches a PENDING DealerProfile to
 * the caller's existing customer account; their role stays CUSTOMER and
 * they keep shopping as one until an admin approves (see
 * packages/auth/src/dealer-application.ts).
 */

/** Current dealer-application status + a prefill of the form (empty when never applied). Any role. */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const application = await getDealerApplicationForUser(userId);
    const user = await getUserBasicInfo(userId);
    // Fall back to the account name so a first-time applicant's form isn't blank.
    const name =
      application?.form.name ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      "";
    return jsonOk({
      application: application
        ? {
            status: application.status,
            kycStatus: application.kycStatus,
            rejectionReason: application.rejectionReason,
            hasPendingChanges: application.hasPendingChanges,
          }
        : null,
      form: {
        name,
        storeName: application?.form.storeName ?? "",
        storeAddress: application?.form.storeAddress ?? "",
        city: application?.form.city ?? "",
        stateId: application?.form.stateId ?? "",
        pincode: application?.form.pincode ?? "",
        gstNumber: application?.form.gstNumber ?? "",
        licenseNumber: application?.form.licenseNumber ?? "",
        gstDocUrl: application?.form.gstDocUrl ?? "",
        licenseDocUrl: application?.form.licenseDocUrl ?? "",
      },
    });
  });
}

/** Submit or resubmit (PENDING / REJECTED) the application for the signed-in customer. */
export async function POST(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId } = await requireMobileAuth(req);
    const body = await parseJsonBody(req);
    const parsed = dealerApplicationSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid application details.",
      );
    }

    const result = await submitDealerApplicationForUser(userId, parsed.data, parsed.data);
    if (!result.ok) return jsonError(400, "APPLICATION_ERROR", result.error);

    return jsonOk({ profileId: result.data.profileId, resubmitted: result.data.resubmitted }, 201);
  });
}
