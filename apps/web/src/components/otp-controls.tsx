"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertBox } from "@kisan4u/ui";

/** Seconds a user must wait after an OTP is sent before "Resend OTP" unlocks. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Keep in sync with OTP_TTL_MINUTES in packages/auth/src/otp.ts — the server rejects the code after this. */
export const OTP_VALID_SECONDS = 5 * 60;
/** Wrong codes allowed on one OTP screen before the user is sent back to start over. */
export const OTP_MAX_FAILED_ATTEMPTS = 5;

/**
 * Client-side clock for an OTP that was just sent: counts down the resend
 * cooldown and flags the moment the code has expired server-side. Call
 * `restart()` every time a fresh OTP goes out (first send or a resend).
 *
 * `autoStart` (default true) is for screens that only exist once an OTP
 * has been sent (the clock starts on mount). Forms where the OTP box
 * appears later inside a bigger form pass `autoStart: false` and call
 * `restart()` themselves when the code goes out — nothing ticks (and the
 * form doesn't re-render every second) until then. `stop()` halts it again.
 *
 * The start time is set in an effect, not during render, so the server-
 * rendered HTML and the first client render agree (both show the full
 * cooldown) — no hydration mismatch from `Date.now()`.
 */
export function useOtpTimers({ autoStart = true }: { autoStart?: boolean } = {}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);

  const restart = useCallback((seconds = OTP_RESEND_COOLDOWN_SECONDS) => {
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    setResendAvailableAt(t + Math.max(1, Math.ceil(seconds)) * 1000);
  }, []);

  const limitResend = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setResendAvailableAt(t + Math.max(1, Math.ceil(seconds)) * 1000);
  }, []);

  const stop = useCallback(() => {
    setStartedAt(null);
    setNow(null);
    setResendAvailableAt(null);
  }, []);

  useEffect(() => {
    if (autoStart) restart();
  }, [autoStart, restart]);

  const elapsed = startedAt === null || now === null ? 0 : Math.floor((now - startedAt) / 1000);
  const expired = elapsed >= OTP_VALID_SECONDS;

  useEffect(() => {
    const resendIn =
      resendAvailableAt === null || now === null
        ? 0
        : Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));
    if ((startedAt === null || expired) && resendIn === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, expired, resendAvailableAt, now]);

  return {
    /** Seconds left before Resend unlocks (0 = unlocked). */
    resendIn:
      resendAvailableAt === null || now === null
        ? 0
        : Math.max(0, Math.ceil((resendAvailableAt - now) / 1000)),
    /** True once the 5-minute validity window has passed. */
    expired,
    restart,
    limitResend,
    stop,
  };
}

/**
 * Counts wrong-code attempts for one OTP screen. `recordFailure()` returns
 * how many attempts are still left; 0 means the limit was just reached and
 * the caller should send the user back to the start.
 *
 * This mirrors the server-side per-code limit; the server remains the
 * authority and enforces it across tabs and clients.
 */
export function useOtpFailureCounter(max: number = OTP_MAX_FAILED_ATTEMPTS) {
  const failures = useRef(0);
  const recordFailure = useCallback(() => {
    failures.current += 1;
    return Math.max(0, max - failures.current);
  }, [max]);
  /** Call when the user starts over (new phone number / fresh OTP screen). */
  const resetFailures = useCallback(() => {
    failures.current = 0;
  }, []);
  return { recordFailure, resetFailures };
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "Resend OTP in 0:29" while cooling down, then a real "Resend OTP" button. */
export function OtpResendButton({
  resendIn,
  onResend,
  pending = false,
  className = "",
}: {
  resendIn: number;
  onResend: () => void;
  pending?: boolean;
  className?: string;
}) {
  if (resendIn > 0) {
    return (
      <span className={`text-xs font-medium text-gray-500 ${className}`} aria-live="polite">
        Resend OTP in {formatCountdown(resendIn)}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onResend}
      disabled={pending}
      className={`text-xs font-semibold text-green-700 hover:underline disabled:opacity-50 ${className}`}
    >
      {pending ? "Sending…" : "Resend OTP"}
    </button>
  );
}

/** Shown in place of the "enter your code" hint once the 5 minutes are up. */
export function OtpExpiredNotice() {
  return (
    <AlertBox tone="warning" title="OTP time up">
      This OTP has expired. Please resend the OTP to get a new code.
    </AlertBox>
  );
}
