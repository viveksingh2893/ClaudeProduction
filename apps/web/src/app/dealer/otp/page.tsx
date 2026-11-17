"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { isValidIndianMobileLocal } from "@kisan4u/validators";
import { AlertBox, Button } from "@kisan4u/ui";
import { PhoneInput } from "@/components/phone-input";
import { AuthCardShell } from "@/components/auth-card-shell";
import {
  OtpExpiredNotice,
  OtpResendButton,
  useOtpFailureCounter,
  useOtpTimers,
} from "@/components/otp-controls";
import { verifyDealerOtpAction } from "@/app/register/dealer/verify/actions";
import { requestDealerLoginOtpAction } from "./actions";

const NOTICES: Record<string, string> = {
  dealer: "This number is registered as a dealer. Continue with dealer login.",
  "already-dealer":
    "This phone number is already registered as a dealer. Please verify OTP to continue.",
};

function DealerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // An OTP was already sent for this phone by whichever page redirected
  // here (customer login detecting a dealer number, or dealer registration
  // detecting an existing dealer) — skip straight to the OTP step so the
  // user verifies exactly one code, not two.
  const prefillPhone = searchParams.get("phone");
  const notice = searchParams.get("notice");
  const next = searchParams.get("next") === "/account/delete" ? "/account/delete" : null;
  // Distinct from `phone` above: this only pre-fills the phone INPUT on
  // the "phone" step (e.g. from the /dealer/status "Got notification? Log
  // in now" button) — no OTP has been sent yet, so it must NOT skip
  // straight to the OTP-entry step the way `phone` does.
  const prefillLocalPhone = searchParams.get("prefillLocal");

  const [step, setStep] = useState<"phone" | "otp">(prefillPhone ? "otp" : "phone");
  const [localPhone, setLocalPhone] = useState(prefillLocalPhone ?? "");
  const [phone, setPhone] = useState(prefillPhone ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Set when the phone has no account at all — verifying the OTP then
  // goes through the registration flow's own verify action (creates a
  // dealer onboarding session + routes to the application form) instead
  // of attempting a login that can never succeed for a nonexistent
  // account. See ./actions.ts.
  const [notRegistered, setNotRegistered] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isResending, startResend] = useTransition();
  const timers = useOtpTimers();
  const { recordFailure } = useOtpFailureCounter();

  /** Wrong code: count it, and after the third one send the user back to the login page to start over. Returns true when they were redirected. */
  function handleWrongCode(message: string): boolean {
    const attemptsLeft = recordFailure();
    if (attemptsLeft === 0) {
      router.replace("/login?notice=otp-attempts");
      return true;
    }
    setCode("");
    setError(`${message} ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`);
    return false;
  }

  function handleResend() {
    setError(null);
    startResend(async () => {
      const result = await requestDealerLoginOtpAction(phone);
      if (!result.ok) {
        if (result.retryAfter) timers.limitResend(result.retryAfter);
        setError(result.error);
        return;
      }
      if (result.redirectTo) {
        router.push(next ? `${result.redirectTo}&next=${encodeURIComponent(next)}` : result.redirectTo);
        return;
      }
      setCode("");
      timers.restart();
    });
  }

  function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidIndianMobileLocal(localPhone)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    startTransition(async () => {
      const result = await requestDealerLoginOtpAction(localPhone);
      if (!result.ok) {
        if (result.retryAfter) timers.limitResend(result.retryAfter);
        setError(result.error);
        return;
      }
      if (result.redirectTo) {
        router.push(next ? `${result.redirectTo}&next=${encodeURIComponent(next)}` : result.redirectTo);
        return;
      }
      setNotRegistered(result.notRegistered ?? false);
      setPhone(`+91${localPhone}`);
      setStep("otp");
      timers.restart();
    });
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (timers.expired) return;
    setError(null);
    startTransition(async () => {
      if (notRegistered) {
        const result = await verifyDealerOtpAction({ phone, code });
        if (!result.ok) {
          handleWrongCode(result.error);
          return;
        }
        router.push(result.redirectTo);
        return;
      }
      const result = await signIn("otp", {
        phone,
        code,
        role: "DEALER",
        redirect: false,
      });
      if (result?.error) {
        handleWrongCode("Invalid or expired OTP, or this number isn't registered as a dealer.");
        return;
      }
      router.push(next ?? "/");
      router.refresh();
    });
  }

  return (
    <AuthCardShell>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-earth-500 to-earth-700">
        <span className="h-[18px] w-[22px] rounded-[3px] border-[3px] border-white" />
      </div>
      <h1 className="text-xl font-extrabold text-earth-700">Dealer Sign In</h1>

      {notice && NOTICES[notice] && (
        <div className="mt-3">
          <AlertBox tone="info">{NOTICES[notice]}</AlertBox>
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={handleSendOtp} className="mt-4 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-600">
              Mobile Number
            </label>
            <PhoneInput value={localPhone} onChange={setLocalPhone} autoFocus />
          </div>
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <Button type="submit" variant="primary" disabled={isPending} fullWidth>
            {isPending ? "Sending…" : "Send OTP"}
          </Button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerify} className="mt-4 flex flex-col gap-4">
          {timers.expired ? (
            <OtpExpiredNotice />
          ) : notRegistered ? (
            <AlertBox tone="info">
              This number isn&apos;t registered as a dealer yet. Verify the code sent to{" "}
              <strong>{phone}</strong> and we&apos;ll take you to the application form.
            </AlertBox>
          ) : (
            <p className="text-sm text-gray-600">
              Code sent to <strong className="text-ink">{phone}</strong>.
            </p>
          )}
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
            {isPending ? "Verifying…" : notRegistered ? "Verify & Continue" : "Verify & Login"}
          </Button>
          <div className="text-center">
            <OtpResendButton
              resendIn={timers.resendIn}
              onResend={handleResend}
              pending={isResending}
            />
          </div>
        </form>
      )}
    </AuthCardShell>
  );
}

export default function DealerLoginPage() {
  return (
    <Suspense fallback={null}>
      <DealerLoginForm />
    </Suspense>
  );
}
