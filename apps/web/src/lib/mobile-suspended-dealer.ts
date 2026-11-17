import type { NextResponse } from "next/server";
import type { PhoneAccountLookup } from "@kisan4u/auth";
import { getSiteSettings } from "@kisan4u/catalog";
import { jsonError } from "@/lib/mobile-api";

/**
 * Pre-OTP gate for the mobile login entry points: a dealer an admin has
 * SUSPENDED must be told so (with the support number) before any OTP is
 * sent. Without this the OTP flow succeeds, and the app then bounces the
 * signed-in-but-not-approved dealer between its auth and app route groups.
 *
 * Returns the 403 response to send, or null when the phone isn't a
 * suspended dealer. The support number is the admin-configured customer-care
 * number (SiteSettings.footerCustomerCareNumber, same one the call-centre
 * screen shows) — `details.supportPhone` is null when none is configured.
 */
export async function suspendedDealerResponse(
  lookup: PhoneAccountLookup,
): Promise<NextResponse | null> {
  if (!lookup.exists || lookup.role !== "DEALER" || lookup.dealerStatus !== "SUSPENDED") {
    return null;
  }
  const supportPhone = (await getSiteSettings()).footerCustomerCareNumber ?? null;
  return jsonError(
    403,
    "DEALER_SUSPENDED",
    supportPhone
      ? `Your dealer account has been suspended. Please call Kisan4U support on ${supportPhone}.`
      : "Your dealer account has been suspended. Please contact Kisan4U support.",
    { supportPhone },
  );
}
