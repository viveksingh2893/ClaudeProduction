"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isValidIndianMobileLocal } from "@kisan4u/validators";
import { AlertBox, Button } from "@kisan4u/ui";
import { PhoneInput } from "@/components/phone-input";
import { AuthCardShell } from "@/components/auth-card-shell";
import { requestDealerRegistrationOtpAction } from "./actions";

/** The phone-entry + OTP step — shown only to a signed-out visitor. A
 *  signed-in customer skips straight to the prefilled application form
 *  (see ./page.tsx, which branches on the session). */
export function DealerRegisterPhoneStep({ tooManyAttempts = false }: { tooManyAttempts?: boolean }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidIndianMobileLocal(phone)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    startTransition(async () => {
      const result = await requestDealerRegistrationOtpAction(phone);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(result.redirectTo);
    });
  }

  return (
    <AuthCardShell>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-earth-500 to-earth-700">
        <span className="h-[18px] w-[22px] rounded-[3px] border-[3px] border-white" />
      </div>
      <h1 className="text-xl font-extrabold text-earth-700">Become a Dealer</h1>
      <p className="mt-1 text-sm text-gray-600">
        Enter your mobile number to get started. We&apos;ll verify it with an OTP before showing the application form.
      </p>
      {tooManyAttempts && (
        <div className="mt-3">
          <AlertBox tone="warning">
            Too many incorrect OTP attempts. Please enter your mobile number to start again.
          </AlertBox>
        </div>
      )}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <PhoneInput value={phone} onChange={setPhone} autoFocus />
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <Button type="submit" variant="primary" disabled={isPending} fullWidth>
          {isPending ? "Sending…" : "Send OTP"}
        </Button>
      </form>
      <p className="mt-5 text-sm text-gray-600">
        Already a dealer?{" "}
        <Link href="/dealer/otp" className="font-bold text-earth-700 hover:underline">
          Login here
        </Link>
        .
      </p>
    </AuthCardShell>
  );
}
