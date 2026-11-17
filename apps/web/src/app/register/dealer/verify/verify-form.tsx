"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertBox, Button } from "@kisan4u/ui";
import {
  OtpExpiredNotice,
  OtpResendButton,
  useOtpFailureCounter,
  useOtpTimers,
} from "@/components/otp-controls";
import { requestDealerRegistrationOtpAction } from "../actions";
import { verifyDealerOtpAction } from "./actions";

export function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") ?? "";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isResending, startResend] = useTransition();
  const timers = useOtpTimers();
  const { recordFailure } = useOtpFailureCounter();

  function handleResend() {
    setError(null);
    startResend(async () => {
      const result = await requestDealerRegistrationOtpAction(phone);
      if (!result.ok) {
        if (result.retryAfter) timers.limitResend(result.retryAfter);
        setError(result.error);
        return;
      }
      setCode("");
      timers.restart();
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (timers.expired) return;
    setError(null);
    startTransition(async () => {
      const result = await verifyDealerOtpAction({ phone, code });
      if (!result.ok) {
        const attemptsLeft = recordFailure();
        if (attemptsLeft === 0) {
          // Five wrong codes: back to the start of registration.
          router.replace("/register/dealer?notice=otp-attempts");
          return;
        }
        setCode("");
        setError(`${result.error} ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`);
        return;
      }
      // The registration form only ever becomes reachable through this
      // server-issued redirect — there's no client-side route the user
      // could jump to directly without a valid, server-verified OTP.
      router.push(result.redirectTo);
    });
  }

  if (!phone) {
    return (
      <p className="mt-2 text-sm text-gray-600">
        Missing phone number — go back to{" "}
        <Link href="/register/dealer" className="font-bold text-earth-700 hover:underline">
          start over
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-4">
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
          className="rounded-lg border-[1.5px] border-border px-3 py-3 text-center text-lg tracking-[6px] outline-none focus:border-earth-600 disabled:bg-gray-50 disabled:opacity-60"
        />
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <Button type="submit" variant="primary" disabled={isPending || timers.expired} fullWidth>
          {isPending ? "Verifying…" : "Verify"}
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
