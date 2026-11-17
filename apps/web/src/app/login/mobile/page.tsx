"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidIndianMobileLocal } from "@kisan4u/validators";
import { AlertBox, Button } from "@kisan4u/ui";
import { PhoneInput } from "@/components/phone-input";
import { AuthCardShell } from "@/components/auth-card-shell";
import { requestCustomerLoginOtpAction } from "../actions";

export default function LoginMobilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");
  const next =
    requestedNext === "/account/delete" || requestedNext === "/account/ba" ? requestedNext : null;
  const [phone, setPhone] = useState("");
  const [referralCode, setReferralCode] = useState((searchParams.get("ref") ?? "").toUpperCase());
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
      const result = await requestCustomerLoginOtpAction(phone, referralCode.trim() || undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(
        next
          ? `${result.redirectTo}${result.redirectTo.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`
          : result.redirectTo,
      );
    });
  }

  return (
    <AuthCardShell>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-green-700">
        <span className="h-5 w-5 rounded-full border-[3px] border-white" />
      </div>
      <h1 className="text-xl font-extrabold text-green-800">Log in / Sign up</h1>
      <p className="mt-1 text-sm text-gray-600">
        Enter your mobile number — we&apos;ll send a one-time code to verify it. New here? Your
        account is created automatically.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-gray-600">Mobile Number</label>
          <PhoneInput value={phone} onChange={setPhone} autoFocus />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-gray-600">
            Referral code <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="BA-A1B2C3D4E5F6"
            className="w-full rounded-lg border-[1.5px] border-border px-3 py-2.5 text-sm outline-none focus:border-green-600"
          />
        </div>
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <Button type="submit" variant="secondary" disabled={isPending} fullWidth>
          {isPending ? "Sending…" : "Send OTP"}
        </Button>
      </form>
    </AuthCardShell>
  );
}
