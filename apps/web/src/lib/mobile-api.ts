import { NextRequest, NextResponse } from "next/server";
import {
  verifyMobileAccessToken,
  validateUserSession,
  getDealerProfileForUser,
  getSellerProfileForUser,
} from "@kisan4u/auth";
import { prisma } from "@kisan4u/db";
import type { UserRole } from "@kisan4u/db";

/**
 * Shared plumbing for every route under /api/mobile/v1/**. Every mobile
 * response uses the same envelope so the Expo app's API client (see
 * apps/mobile/src/lib/api-client.ts) can handle success/error uniformly
 * instead of each screen re-deriving its own error shape.
 */

export type MobileAuthContext = { userId: string; role: UserRole; sessionId: string | null };

export class MobileApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/**
 * Verifies the bearer access token AND re-checks live account state
 * (active + not revoked) on every call — the exact same
 * `validateUserSession` the website re-checks on every protected Node-
 * context request (see packages/auth/src/access.ts). This is what makes
 * admin suspending a dealer/seller take effect on their next mobile API
 * call, not just their next login.
 */
export async function requireMobileAuth(
  req: NextRequest,
  allowedRoles?: UserRole[],
): Promise<MobileAuthContext> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) throw new MobileApiError(401, "UNAUTHENTICATED", "Missing bearer token.");

  const verified = await verifyMobileAccessToken(token);
  if (!verified)
    throw new MobileApiError(401, "TOKEN_INVALID", "Access token is invalid or expired.");

  const session = await validateUserSession(
    verified.uid,
    verified.sessionVersion,
    verified.sessionId,
  );
  if (!session.valid) {
    if (session.reason === "deletion_pending") {
      const path = req.nextUrl.pathname;
      const allowedWhilePending = path.endsWith("/auth/me") || path.includes("/account/deletion");
      if (allowedWhilePending)
        return { userId: verified.uid, role: verified.role, sessionId: verified.sessionId };
      throw new MobileApiError(
        403,
        "ACCOUNT_DELETION_PENDING",
        "Your account is scheduled for deletion. Restore it to continue.",
      );
    }
    const message =
      session.reason === "revoked" || session.reason === "mobile_session_revoked"
        ? "Your session is no longer valid. Please log in again."
        : session.reason === "inactive"
          ? "This account has been deactivated."
          : "Account not found.";
    throw new MobileApiError(401, "SESSION_INVALID", message);
  }

  if (allowedRoles && !allowedRoles.includes(verified.role)) {
    throw new MobileApiError(403, "FORBIDDEN", "You do not have access to this resource.");
  }

  return { userId: verified.uid, role: verified.role, sessionId: verified.sessionId };
}

/** Wraps a route handler body so MobileApiError and unexpected throws both produce the same JSON error envelope instead of an unhandled 500 HTML page. */
export async function withMobileApi(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof MobileApiError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-api] unhandled error", error);
    return jsonError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }
}

export async function parseJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new MobileApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

/** Same checks as requireMobileAuth, but returns null instead of throwing when there's no bearer token at all — for guest-browsable routes (homepage, catalog, product detail) that render differently for a logged-in DEALER but must not require login. An invalid/expired token still throws, so a client can tell "not logged in" apart from "your session expired." */
export async function optionalMobileAuth(req: NextRequest): Promise<MobileAuthContext | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return null;
  return requireMobileAuth(req);
}

export type MobileBuyerContext = {
  userId: string;
  role: "CUSTOMER" | "DEALER";
  dealerState: { id: string; name: string } | null;
  /**
   * A not-yet-verified guest placeholder (POST /api/mobile/v1/auth/guest).
   * Browsing + cart + checkout-preview are fine; the routes that actually
   * commit an order reject it and make the app run the mobile-number OTP
   * verify first — mirrors apps/web's strict placeOrderAction for guests.
   */
  isGuest: boolean;
};

/**
 * Mobile equivalent of apps/web/src/lib/buyer-context.ts's
 * requireBuyerContext — same rules (a DEALER must have an APPROVED
 * profile, the buying state is always re-derived server-side from
 * DealerProfile.stateId, never client input), just throwing a
 * MobileApiError instead of doing a Next.js redirect() since there is no
 * page navigation on an API route.
 */
export async function requireMobileBuyerContext(req: NextRequest): Promise<MobileBuyerContext> {
  const { userId, role } = await requireMobileAuth(req, ["CUSTOMER", "DEALER"]);

  if (role === "DEALER") {
    const profile = await getDealerProfileForUser(userId);
    if (!profile) throw new MobileApiError(401, "SESSION_INVALID", "Dealer profile not found.");
    if (profile.status !== "APPROVED") {
      throw new MobileApiError(
        403,
        "DEALER_NOT_APPROVED",
        "Your dealer account is not approved yet.",
      );
    }
    const dealerState = profile.stateId
      ? await prisma.indianState.findUnique({
          where: { id: profile.stateId },
          select: { id: true, name: true },
        })
      : null;
    return { userId, role: "DEALER", dealerState, isGuest: false };
  }

  const customer = await prisma.user.findUnique({
    where: { id: userId },
    select: { isGuest: true },
  });
  return { userId, role: "CUSTOMER", dealerState: null, isGuest: customer?.isGuest ?? false };
}

/** Mirrors apps/web's dealer pages' own gate (requireSession(["DEALER"]) + APPROVED check) — for the dealer-only bulk catalogue/requests endpoints, distinct from requireMobileBuyerContext which also allows CUSTOMER. */
export async function requireMobileApprovedDealer(
  req: NextRequest,
): Promise<{ userId: string; dealerProfileId: string; dealerStateId: string | null }> {
  const { userId } = await requireMobileAuth(req, ["DEALER"]);
  const profile = await getDealerProfileForUser(userId);
  if (!profile) throw new MobileApiError(401, "SESSION_INVALID", "Dealer profile not found.");
  if (profile.status !== "APPROVED") {
    throw new MobileApiError(
      403,
      "DEALER_NOT_APPROVED",
      "Your dealer account is not approved yet.",
    );
  }
  return { userId, dealerProfileId: profile.id, dealerStateId: profile.stateId };
}

/** Mirrors apps/dashboard/src/lib/require-approved-seller.ts's requireApprovedSeller — only an APPROVED seller may manage products/orders. */
export async function requireMobileApprovedSeller(
  req: NextRequest,
): Promise<{ userId: string; sellerProfileId: string }> {
  const { userId } = await requireMobileAuth(req, ["SELLER"]);
  const profile = await getSellerProfileForUser(userId);
  if (!profile) throw new MobileApiError(401, "SESSION_INVALID", "Seller profile not found.");
  if (profile.status !== "APPROVED") {
    throw new MobileApiError(
      403,
      "SELLER_NOT_APPROVED",
      "Your seller account is not approved yet.",
    );
  }
  return { userId, sellerProfileId: profile.id };
}

export type CatalogViewer = { audience: "CUSTOMER" | "DEALER"; dealerStateId: string | null };

/**
 * Resolves which pricing/catalogue audience a request should see —
 * shared by homepage/catalog/product-detail routes so "guest or customer
 * sees customer pricing, only an APPROVED dealer sees dealer pricing" is
 * decided in exactly one place. An unauthenticated request or a DEALER
 * whose application isn't APPROVED yet both fall back to CUSTOMER,
 * matching the website (packages/catalog/src/queries.ts).
 */
export async function resolveCatalogViewer(req: NextRequest): Promise<CatalogViewer> {
  const auth = await optionalMobileAuth(req);
  if (auth?.role === "DEALER") {
    const profile = await getDealerProfileForUser(auth.userId);
    if (profile?.status === "APPROVED") {
      const dealerStateId = profile.stateId
        ? ((
            await prisma.indianState.findUnique({
              where: { id: profile.stateId },
              select: { id: true },
            })
          )?.id ?? null)
        : null;
      return { audience: "DEALER", dealerStateId };
    }
  }
  return { audience: "CUSTOMER", dealerStateId: null };
}

export function parsePagination(url: URL): { page: number; pageSize: number } {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  return { page, pageSize };
}
