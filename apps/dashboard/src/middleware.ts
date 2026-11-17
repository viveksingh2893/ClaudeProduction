import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  if (!isLoggedIn) {
    if (isApi) {
      return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isApi) {
    const allowed = path.startsWith("/api/seller-licences")
      ? role === "ADMIN" || role === "SELLER"
      : path.startsWith("/api/seller/")
        ? role === "SELLER"
        : role === "ADMIN" || role === "STAFF";
    return allowed
      ? NextResponse.next()
      : NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (path.startsWith("/admin") && role !== "ADMIN" && role !== "STAFF") {
    return NextResponse.redirect(new URL("/seller", req.url));
  }
  if (path.startsWith("/seller") && role !== "SELLER") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/seller/:path*",
    "/api/admin/:path*",
    "/api/seller/:path*",
    "/api/pos/:path*",
    "/api/payment-verification/:path*",
    "/api/seller-licences/:path*",
  ],
};
