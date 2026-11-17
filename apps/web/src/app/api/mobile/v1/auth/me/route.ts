import { NextRequest } from "next/server";
import { prisma } from "@kisan4u/db";
import {
  getUserBasicInfo,
  getDealerProfileForUser,
  getSellerProfileForUser,
  getDealerApplicationForUser,
} from "@kisan4u/auth";
import { jsonError, jsonOk, requireMobileAuth, withMobileApi } from "@/lib/mobile-api";

/** Current user + role-specific application status, read fresh from the DB on every call (never trusts JWT claims for anything beyond identity). */
export async function GET(req: NextRequest) {
  return withMobileApi(async () => {
    const { userId, role } = await requireMobileAuth(req);
    const user = await getUserBasicInfo(userId);
    if (!user) return jsonError(404, "NOT_FOUND", "User not found.");

    let dealerStatus: {
      status: string;
      kycStatus: string;
      rejectionReason: string | null;
      dealerState: { id: string; name: string } | null;
    } | null = null;
    let sellerStatus: { status: string; shopName: string; rejectionReason: string | null } | null =
      null;

    if (role === "DEALER") {
      const profile = await getDealerProfileForUser(userId);
      if (profile) {
        // Same lookup requireMobileBuyerContext uses to lock a dealer's
        // address state — exposed here so the app can pre-fill/disable the
        // state field instead of only finding out at submit time.
        const dealerState = profile.stateId
          ? await prisma.indianState.findUnique({
              where: { id: profile.stateId },
              select: { id: true, name: true },
            })
          : null;
        dealerStatus = {
          status: profile.status,
          kycStatus: profile.kycStatus,
          rejectionReason: profile.rejectionReason,
          dealerState,
        };
      }
    }
    if (role === "SELLER") {
      const profile = await getSellerProfileForUser(userId);
      if (profile) {
        sellerStatus = {
          status: profile.status,
          shopName: profile.shopName,
          rejectionReason: profile.rejectionReason,
        };
      }
    }

    // "Become a Dealer" state for the storefront button — a CUSTOMER can
    // have a PENDING/REJECTED DealerProfile while still signed in as a
    // customer, so this is reported for every role (null when they've
    // never applied; a role:DEALER caller simply won't show the button).
    const app = await getDealerApplicationForUser(userId);
    const dealerApplication = app
      ? {
          status: app.status,
          rejectionReason: app.rejectionReason,
          hasPendingChanges: app.hasPendingChanges,
        }
      : null;

    return jsonOk({ user, dealerStatus, sellerStatus, dealerApplication });
  });
}
