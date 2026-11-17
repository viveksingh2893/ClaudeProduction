"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertBox, Button } from "@kisan4u/ui";
import {
  OtpExpiredNotice,
  OtpResendButton,
  useOtpFailureCounter,
  useOtpTimers,
} from "@/components/otp-controls";
import { claimReferralAction, requestCustomerLoginOtpAction } from "../actions";

const NOTICES: Record<string, string> = {
  customer: "This number is registered as a customer account.",
};

export function OtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") ?? "";
  const notice = searchParams.get("notice");
  const requestedNext = searchParams.get("next");
  const next = requestedNext === "/account/delete" || requestedNext === "/account/ba" ? requestedNext : "/";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isResending, startResend] = useTransition();
  const timers = useOtpTimers();
  const { recordFailure } = useOtpFailureCounter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (timers.expired) return;
    setError(null);
    startTransition(async () => {
      const result = await signIn("otp", {
        phone,
        code,
        redirect: false,
      });
      if (result?.error) {
        const attemptsLeft = recordFailure();
        if (attemptsLeft === 0) {
          // Five wrong codes: back to the login page to start over.
          router.replace("/login?notice=otp-attempts");
          return;
        }
        setCode("");
        setError(
          `Invalid or expired OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
        );
        return;
      }
      // Safe no-op for existing accounts or when no referral is stashed.
      await claimReferralAction().catch(() => {});
      router.push(next);
      router.refresh();
    });
  }

  function handleResend() {
    setError(null);
    startResend(async () => {
      const result = await requestCustomerLoginOtpAction(phone);
      if (!result.ok) {
        if (result.retryAfter) timers.limitResend(result.retryAfter);
        setError(result.error);
        return;
      }
      setCode("");
      timers.restart();
    });
  }

  if (!phone) {
    return (
      <p className="mt-2 text-sm text-gray-600">
        Missing phone number — go back and request an OTP first.
      </p>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-4">
      {notice && NOTICES[notice] && <AlertBox tone="info">{NOTICES[notice]}</AlertBox>}
      {timers.expired ? (
        <OtpExpiredNotice />
      ) : (
        <p className="text-sm text-gray-600">
          Code sent to <strong className="text-ink">{phone}</strong>.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          inputMode="numeric"
          placeholder="6-digit code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          maxLength={6}
          required
          disabled={timers.expired}
          className="rounded-lg border-[1.5px] border-border px-3 py-3 text-center text-lg tracking-[6px] outline-none focus:border-green-600 disabled:bg-gray-50 disabled:opacity-60"
        />
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <Button type="submit" variant="secondary" disabled={isPending || timers.expired} fullWidth>
          {isPending ? "Verifying…" : "Verify & Login"}
        </Button>
      </form>
      <div className="text-center">
        <OtpResendButton
          resendIn={timers.resendIn}
          onResend={handleResend}
          pending={isResending}
        />
      </div>
    </div>
  );
}
