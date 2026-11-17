import Constants from "expo-constants";
import { getStoredTokens, storeTokens, clearTokens } from "./secure-storage";
import { getDeviceHeaders } from "./device-identity";

/**
 * Typed client for /api/mobile/v1/** (apps/web) — the only way this app
 * talks to the backend; it never touches the database directly.
 *
 * Base URL resolution, in order:
 *   1. EXPO_PUBLIC_API_URL — dev override (e.g. a LAN IP while iterating
 *      against a laptop, see .env.example)
 *   2. expo.extra.apiUrl in app.json — the baked-in default that ships in
 *      release builds (the production Cloudflare tunnel, https://katra4u.com)
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export type ApiError = { code: string; message: string; details?: Record<string, unknown> };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

let inFlightRefresh: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const tokens = await getStoredTokens();
  if (!tokens || !API_BASE_URL) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/mobile/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Version": Constants.expoConfig?.version || "0.0.0",
        ...(await getDeviceHeaders()),
      },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    const json = (await res.json()) as Envelope<{ accessToken: string; refreshToken: string }>;
    if (!res.ok || !json.ok) return false;
    await storeTokens(json.data.accessToken, json.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: Method;
  body?: unknown;
  /** Attach the bearer token if one is stored. Default true — pass false only for the handful of genuinely public endpoints where sending a stale/absent token should never matter. */
  auth?: boolean;
  /** Internal — prevents an infinite refresh loop on a second 401. */
  isRetry?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  if (!API_BASE_URL) {
    return {
      ok: false,
      error: {
        code: "CONFIG_ERROR",
        message:
          "EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to .env.local and set your computer's LAN IP.",
      },
    };
  }
  const { method = "GET", body, auth = true, isRetry = false } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-App-Version": Constants.expoConfig?.version || "0.0.0",
    ...(await getDeviceHeaders()),
  };
  if (auth) {
    const tokens = await getStoredTokens();
    if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: "Couldn't reach the server. Check your Wi-Fi and the API URL.",
      },
    };
  }

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    // No JSON body (rare — e.g. a proxy error page). Fall through to the status-based error below.
  }

  if (res.status === 401 && auth && !isRetry) {
    inFlightRefresh ??= refreshAccessToken().finally(() => {
      inFlightRefresh = null;
    });
    const refreshed = await inFlightRefresh;
    if (refreshed) return request<T>(path, { ...options, isRetry: true });

    await clearTokens();
    sessionExpiredHandler?.();
    return {
      ok: false,
      error: { code: "SESSION_EXPIRED", message: "Your session has expired. Please log in again." },
    };
  }

  if (!res.ok || !json || !json.ok) {
    return {
      ok: false,
      error:
        json && !json.ok
          ? json.error
          : { code: "HTTP_ERROR", message: `Request failed (${res.status}).` },
    };
  }

  return { ok: true, data: json.data };
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};
