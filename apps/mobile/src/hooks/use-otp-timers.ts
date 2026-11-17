import { useCallback, useEffect, useRef, useState } from "react";

export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_VALID_SECONDS = 5 * 60;
export const OTP_MAX_FAILED_ATTEMPTS = 5;

export function getOtpTiming(elapsedSeconds: number) {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds));
  return {
    resendIn: Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsed),
    expired: elapsed >= OTP_VALID_SECONDS,
  };
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function useOtpTimers({ autoStart = true }: { autoStart?: boolean } = {}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);

  const restart = useCallback((seconds = OTP_RESEND_COOLDOWN_SECONDS) => {
    const timestamp = Date.now();
    setStartedAt(timestamp);
    setNow(timestamp);
    setResendAvailableAt(timestamp + Math.max(1, Math.ceil(seconds)) * 1000);
  }, []);

  const limitResend = useCallback((seconds: number) => {
    const timestamp = Date.now();
    setNow(timestamp);
    setResendAvailableAt(timestamp + Math.max(1, Math.ceil(seconds)) * 1000);
  }, []);

  const stop = useCallback(() => {
    setStartedAt(null);
    setNow(null);
    setResendAvailableAt(null);
  }, []);

  useEffect(() => {
    if (autoStart) restart();
  }, [autoStart, restart]);

  const elapsed = startedAt === null || now === null ? 0 : (now - startedAt) / 1000;
  const timing = {
    resendIn:
      resendAvailableAt === null || now === null
        ? 0
        : Math.max(0, Math.ceil((resendAvailableAt - now) / 1000)),
    expired: elapsed >= OTP_VALID_SECONDS,
  };

  useEffect(() => {
    if ((startedAt === null || timing.expired) && timing.resendIn === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, timing.expired, timing.resendIn]);

  return { ...timing, restart, limitResend, stop };
}

export function otpRetryAfter(details?: Record<string, unknown>): number | null {
  const value = Number(details?.retryAfter);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

export function useOtpFailureCounter(max = OTP_MAX_FAILED_ATTEMPTS) {
  const failures = useRef(0);
  const recordFailure = useCallback(() => {
    failures.current += 1;
    return Math.max(0, max - failures.current);
  }, [max]);
  const resetFailures = useCallback(() => {
    failures.current = 0;
  }, []);
  return { recordFailure, resetFailures };
}
