import type { UserRole } from "@kisan4u/db";
import { api } from "@/lib/api-client";

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };
export type AuthUserDTO = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  /** A not-yet-verified guest placeholder — browse + cart only, verified at checkout. */
  isGuest?: boolean;
};

/** Start a guest browsing session — called once when the app has no stored tokens. */
export function startGuestSession() {
  return api.post<TokenPair & { isGuest: true; user: AuthUserDTO }>(
    "/api/mobile/v1/auth/guest",
    undefined,
    { auth: false },
  );
}

export function requestCustomerOtp(phone: string, purpose: "login" | "guest_checkout" = "login") {
  return api.post<{ sent: true; phone: string }>(
    "/api/mobile/v1/auth/otp/request",
    { phone, purpose },
    { auth: false },
  );
}

export function verifyOtp(input: {
  phone: string;
  code: string;
  role?: "CUSTOMER" | "DEALER";
  purpose?: "login" | "guest_checkout";
  name?: string;
  /** Optional BA referral code — applied only for a brand-new account. */
  referralCode?: string;
}) {
  // Sends the current bearer token when there is one: a guest-browsing
  // session carries a guest token, and the server claims that guest's
  // cart onto the resolved real account. A first-time login has no token
  // and the header is simply omitted.
  return api.post<
    TokenPair & { isNewAccount: boolean; claimedCartItems?: number; user: AuthUserDTO }
  >("/api/mobile/v1/auth/otp/verify", input);
}

export function loginWithPassword(email: string, password: string) {
  return api.post<TokenPair & { user: AuthUserDTO }>(
    "/api/mobile/v1/auth/login",
    { email, password },
    { auth: false },
  );
}
