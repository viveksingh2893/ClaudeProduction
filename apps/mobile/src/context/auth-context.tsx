import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UserRole } from "@kisan4u/db";
import { api, setSessionExpiredHandler } from "@/lib/api-client";
import { startGuestSession } from "@/lib/api/auth";
import { getStoredTokens, storeTokens, clearTokens } from "@/lib/secure-storage";
import { schedulePushTokenSync, clearPushToken } from "@/lib/push";

export type AuthUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  /** True while this is an unverified guest placeholder — browse + cart only. */
  isGuest: boolean;
  deletionRequestedAt: string | Date | null;
  deletionScheduledFor: string | Date | null;
};
export type DealerStatus = {
  status: string;
  kycStatus: string;
  rejectionReason: string | null;
  dealerState: { id: string; name: string } | null;
};
export type SellerStatus = { status: string; shopName: string; rejectionReason: string | null };
/**
 * A customer's "Become a Dealer" application state — present for ANY role
 * (a CUSTOMER keeps shopping as one while their DealerProfile is PENDING).
 * `null` = never applied. Drives the storefront button:
 * none → "Become a Dealer", PENDING → "Pending approval",
 * REJECTED → "Application rejected", and a role:DEALER user hides it.
 */
export type DealerApplication = {
  status: string;
  rejectionReason: string | null;
  hasPendingChanges: boolean;
};

type MeResponse = {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    role: UserRole;
    isGuest?: boolean;
    deletionRequestedAt: string | null;
    deletionScheduledFor: string | null;
  };
  dealerStatus: DealerStatus | null;
  sellerStatus: SellerStatus | null;
  dealerApplication: DealerApplication | null;
};

type AuthState = {
  status: "loading" | "authenticated" | "unauthenticated";
  user: AuthUser | null;
  dealerStatus: DealerStatus | null;
  sellerStatus: SellerStatus | null;
  dealerApplication: DealerApplication | null;
};

type TokenPair = { accessToken: string; refreshToken: string };

/** Accepted by completeLogin — the API's AuthUserDTO shape (isGuest optional). */
type LoginUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  isGuest?: boolean;
};

type AuthContextValue = AuthState & {
  /** `true` when the session is an unverified guest placeholder. */
  isGuest: boolean;
  /** Persists tokens + user identity after a successful OTP verify or password login. */
  completeLogin: (tokens: TokenPair, user: LoginUser) => Promise<void>;
  /** Start (or reuse) a guest browsing session — called from the "Continue as guest" button on the login screen. */
  continueAsGuest: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
    dealerStatus: null,
    sellerStatus: null,
    dealerApplication: null,
  });
  const startingGuest = useRef(false);

  const loadProfile = useCallback(async () => {
    const result = await api.get<MeResponse>("/api/mobile/v1/auth/me");
    if (!result.ok) {
      setState({
        status: "unauthenticated",
        user: null,
        dealerStatus: null,
        sellerStatus: null,
        dealerApplication: null,
      });
      return;
    }
    const isGuest = result.data.user.isGuest ?? false;
    setState({
      status: "authenticated",
      user: {
        id: result.data.user.id,
        firstName: result.data.user.firstName,
        lastName: result.data.user.lastName,
        role: result.data.user.role,
        isGuest,
        deletionRequestedAt: result.data.user.deletionRequestedAt,
        deletionScheduledFor: result.data.user.deletionScheduledFor,
      },
      dealerStatus: result.data.dealerStatus,
      sellerStatus: result.data.sellerStatus,
      dealerApplication: result.data.dealerApplication ?? null,
    });
    // Register this device for push once a real account is signed in
    // (guests get no push — they have no durable identity). Best-effort.
    if (!isGuest) schedulePushTokenSync();
  }, []);

  // The login screen's "Continue as guest" — mints a guest bearer for a
  // fresh isGuest placeholder so the storefront is browsable; the account
  // is claimed at checkout via OTP. Returns whether it succeeded so the
  // caller can navigate only on success.
  const continueAsGuest = useCallback(async (): Promise<boolean> => {
    if (startingGuest.current) return false;
    startingGuest.current = true;
    try {
      const result = await startGuestSession();
      if (!result.ok) return false;
      await storeTokens(result.data.accessToken, result.data.refreshToken);
      setState({
        status: "authenticated",
        user: {
          id: result.data.user.id,
          firstName: result.data.user.firstName,
          lastName: result.data.user.lastName,
          role: result.data.user.role,
          isGuest: true,
          deletionRequestedAt: null,
          deletionScheduledFor: null,
        },
        dealerStatus: null,
        sellerStatus: null,
        dealerApplication: null,
      });
      return true;
    } finally {
      startingGuest.current = false;
    }
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      // A real (or guest) session expired / was revoked — back to the
      // login screen, not a silent re-auth.
      setState({
        status: "unauthenticated",
        user: null,
        dealerStatus: null,
        sellerStatus: null,
        dealerApplication: null,
      });
    });
    (async () => {
      const tokens = await getStoredTokens();
      if (!tokens) {
        setState({
          status: "unauthenticated",
          user: null,
          dealerStatus: null,
          sellerStatus: null,
          dealerApplication: null,
        });
        return;
      }
      await loadProfile();
    })();
    return () => setSessionExpiredHandler(null);
  }, [loadProfile]);

  const completeLogin = useCallback(
    async (tokens: TokenPair, _user: LoginUser) => {
      await storeTokens(tokens.accessToken, tokens.refreshToken);
      // Keep the auth screen mounted until /auth/me has produced the final
      // state. Publishing an intermediate authenticated state previously
      // triggered AuthLayout's redirect, then the OTP screen redirected a
      // second time, mounting Home and its image/API work twice.
      await loadProfile();
    },
    [loadProfile],
  );

  const logout = useCallback(async () => {
    await clearPushToken();
    await api.post("/api/mobile/v1/auth/logout").catch(() => {});
    await clearTokens();
    setState({
      status: "unauthenticated",
      user: null,
      dealerStatus: null,
      sellerStatus: null,
      dealerApplication: null,
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isGuest: state.user?.isGuest ?? false,
      completeLogin,
      continueAsGuest,
      logout,
      refreshProfile: loadProfile,
    }),
    [state, completeLogin, continueAsGuest, logout, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}
