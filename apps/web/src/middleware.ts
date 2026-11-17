import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { verifyMobileAccessToken } from "@kisan4u/auth/src/mobile-tokens";
import { isPublicMobileRoute } from "./lib/mobile-route-policy";

const { auth } = NextAuth(authConfig);

function mobileError(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export default auth(async (req) => {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/mobile/v1/")) {
    if (isPublicMobileRoute(path)) {
      return NextResponse.next();
    }
    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return mobileError(401, "UNAUTHENTICATED", "Missing bearer token.");
    if (!(await verifyMobileAccessToken(token))) {
      return mobileError(401, "TOKEN_INVALID", "Access token is invalid or expired.");
    }
    return NextResponse.next();
  }

  const isLoggedIn = !!req.auth;
  if (!isLoggedIn) {
    const isReturnableAccountPage = path === "/account/ba" || path === "/account/delete";
    const loginUrl = new URL(isReturnableAccountPage ? "/login/mobile" : "/login", req.url);
    if (isReturnableAccountPage) loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/account/:path*", "/api/mobile/v1/:path*"],
};
