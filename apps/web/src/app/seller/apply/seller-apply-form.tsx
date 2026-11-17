"use client";

import { useState, useTransition } from "react";
import {
  AlertBox,
  Button,
  Card,
  FormFileInput,
  FormInput,
  FormSelect,
} from "@kisan4u/ui";
import { isValidIndianMobileLocal, GSTIN_REGEX } from "@kisan4u/validators";
import {
  OtpExpiredNotice,
  OtpResendButton,
  useOtpFailureCounter,
  useOtpTimers,
} from "@/components/otp-controls";
import {
  registerSellerAction,
  requestSellerApplyOtpAction,
  verifySellerApplyOtpAction,
} from "./actions";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

async function uploadSellerDocument(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/seller/apply/upload-document", { method: "POST", body });
  const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
  if (!res.ok || !data.ok || !data.url) {
    return { ok: false, error: data.error ?? "Upload failed. Please try again." };
  }
  return { ok: true, url: data.url };
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 border-t border-border pt-5 text-sm font-extrabold uppercase tracking-wide text-green-800 first:mt-0 first:border-t-0 first:pt-0 sm:col-span-2">
      {children}
    </h2>
  );
}

export function SellerApplyForm({
  states,
  dashboardUrl,
}: {
  states: string[];
  dashboardUrl: string;
}) {
  const [done, setDone] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [contactPersonName, setContactPersonName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");

  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrDistrict, setAddrDistrict] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrPincode, setAddrPincode] = useState("");

  // --- Mobile OTP verification (same flow as guest checkout) ---
  const [otpStage, setOtpStage] = useState<"idle" | "sent" | "verified">("idle");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [phoneToken, setPhoneToken] = useState("");
  const [otpPending, startOtpTransition] = useTransition();
  // autoStart:false — the clock only runs once a code has actually been sent.
  const otpTimers = useOtpTimers({ autoStart: false });
  const { recordFailure: recordOtpFailure, resetFailures: resetOtpFailures } =
    useOtpFailureCounter();

  const [gstNumber, setGstNumber] = useState("");
  const [gstDocFile, setGstDocFile] = useState<File | null>(null);
  const [panDocFile, setPanDocFile] = useState<File | null>(null);

  const [bankName, setBankName] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [bankBranch, setBankBranch] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pickFile(setFile: (f: File | null) => void, label: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      if (file && file.size > MAX_UPLOAD_BYTES) {
        setError(`${label} must be under 5 MB.`);
        e.target.value = "";
        setFile(null);
        return;
      }
      setError(null);
      setFile(file);
    };
  }

  function resetPhoneVerification() {
    setOtpStage("idle");
    setOtpCode("");
    setOtpError(null);
    setPhoneToken("");
    otpTimers.stop();
    resetOtpFailures();
  }

  function handleSendOtp() {
    setOtpError(null);
    const phone = mobileNumber.trim();
    if (!isValidIndianMobileLocal(phone)) {
      setOtpError("Enter a valid 10-digit Indian mobile number first.");
      return;
    }
    startOtpTransition(async () => {
      const result = await requestSellerApplyOtpAction(phone);
      if (!result.ok) {
        if (result.retryAfter) otpTimers.limitResend(result.retryAfter);
        setOtpError(result.error);
        return;
      }
      setOtpCode("");
      setOtpStage("sent");
      otpTimers.restart();
    });
  }

  function handleConfirmOtp() {
    if (otpTimers.expired) return;
    setOtpError(null);
    if (!/^\d{6}$/.test(otpCode)) {
      setOtpError("Enter the 6-digit code.");
      return;
    }
    startOtpTransition(async () => {
      const result = await verifySellerApplyOtpAction({ phone: mobileNumber.trim(), code: otpCode });
      if (!result.ok) {
        const attemptsLeft = recordOtpFailure();
        if (attemptsLeft === 0) {
          // Five wrong codes: back to the mobile-number step to start over.
          resetPhoneVerification();
          setOtpError("Too many incorrect OTP attempts. Please verify your mobile number again.");
          return;
        }
        setOtpCode("");
        setOtpError(`${result.error} ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`);
        return;
      }
      setPhoneToken(result.token);
      setOtpStage("verified");
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (otpStage !== "verified" || !phoneToken) {
      setError("Verify your mobile number with the OTP before submitting.");
      return;
    }
    if (!GSTIN_REGEX.test(gstNumber.trim().toUpperCase())) {
      setError("Enter a valid 15-character GST number (e.g. 27ABCDE1234F1Z5).");
      return;
    }
    if (!gstDocFile) {
      setError("Upload your GST certificate.");
      return;
    }
    if (!panDocFile) {
      setError("Upload your PAN card.");
      return;
    }

    startTransition(async () => {
      const gstUpload = await uploadSellerDocument(gstDocFile);
      if (!gstUpload.ok) {
        setError(`GST certificate: ${gstUpload.error}`);
        return;
      }
      const panUpload = await uploadSellerDocument(panDocFile);
      if (!panUpload.ok) {
        setError(`PAN card: ${panUpload.error}`);
        return;
      }

      const result = await registerSellerAction({
        companyName,
        contactPersonName,
        companyWebsite,
        mobileNumber,
        email,
        phoneVerificationToken: phoneToken,
        gstNumber,
        gstDocUrl: gstUpload.url,
        registeredAddressLine1: addrLine1,
        registeredAddressLine2: addrLine2,
        registeredCity: addrCity,
        registeredDistrict: addrDistrict,
        registeredState: addrState,
        registeredPincode: addrPincode,
        bankName,
        accountHolderName,
        accountNumber,
        ifscCode,
        bankBranch,
        panDocUrl: panUpload.url,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <Card className="flex w-full flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700">
          ✓
        </div>
        <h1 className="text-xl font-extrabold text-green-800">Application Submitted</h1>
        <p className="text-sm leading-relaxed text-gray-600">
          Your seller application is now <strong className="text-ink">pending review</strong>. Once
          an admin approves it, we&rsquo;ll send you a{" "}
          <strong className="text-ink">temporary password</strong>.
        </p>
        <p className="text-sm text-gray-600">
          Sign in at the{" "}
          <a href={`${dashboardUrl}/login`} className="font-bold text-green-700 hover:underline">
            Kisan4U Dashboard
          </a>{" "}
          with your email and that password — you&rsquo;ll be asked to set your own password on first
          login.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-7">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SectionHeading>Company details</SectionHeading>
        <FormInput
          label="Company Name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
        />
        <FormInput
          label="Contact Person's Name"
          value={contactPersonName}
          onChange={(e) => setContactPersonName(e.target.value)}
          required
        />
        <FormInput
          label="Company Website (optional)"
          type="url"
          placeholder="https://example.com"
          value={companyWebsite}
          onChange={(e) => setCompanyWebsite(e.target.value)}
        />

        <div className="flex flex-col gap-2 sm:col-span-2">
          <div className="flex items-end gap-2">
            <div className="flex-1 sm:max-w-xs">
              <FormInput
                label="Mobile Number"
                type="tel"
                inputMode="numeric"
                placeholder="10-digit mobile number"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                readOnly={otpStage !== "idle"}
                disabled={otpStage !== "idle"}
                required
              />
            </div>
            {otpStage === "verified" ? (
              <span className="mb-2 inline-flex items-center gap-1 whitespace-nowrap text-sm font-bold text-green-700">
                ✓ Verified
              </span>
            ) : otpStage === "idle" ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleSendOtp}
                disabled={otpPending || !isValidIndianMobileLocal(mobileNumber.trim())}
              >
                {otpPending ? "Sending…" : "Verify"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={resetPhoneVerification}
                disabled={otpPending}
              >
                Change
              </Button>
            )}
          </div>

          {otpStage === "sent" && (
            <div className="flex flex-col gap-2 rounded-lg border-[1.5px] border-green-100 bg-green-50/60 p-3.5">
              {otpTimers.expired ? (
                <OtpExpiredNotice />
              ) : (
                <label className="text-xs font-semibold text-gray-600">
                  Enter the 6-digit code sent to {mobileNumber.trim()}
                </label>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="******"
                  disabled={otpTimers.expired}
                  className="w-40 rounded-lg border-[1.5px] border-border px-3 py-2.5 text-center text-lg tracking-[6px] outline-none focus:border-green-600 disabled:bg-gray-50 disabled:opacity-60"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleConfirmOtp}
                  disabled={otpPending || otpTimers.expired || otpCode.length !== 6}
                >
                  {otpPending ? "Verifying…" : "Confirm"}
                </Button>
                <OtpResendButton
                  resendIn={otpTimers.resendIn}
                  onResend={handleSendOtp}
                  pending={otpPending}
                />
              </div>
            </div>
          )}

          {otpError && <p className="text-xs font-medium text-danger">{otpError}</p>}
        </div>

        <FormInput
          label="Email ID"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <SectionHeading>Registered address</SectionHeading>
        <FormInput
          label="Address line 1"
          className="sm:col-span-2"
          value={addrLine1}
          onChange={(e) => setAddrLine1(e.target.value)}
          required
        />
        <FormInput
          label="Address line 2 (optional)"
          className="sm:col-span-2"
          value={addrLine2}
          onChange={(e) => setAddrLine2(e.target.value)}
        />
        <FormInput
          label="City"
          value={addrCity}
          onChange={(e) => setAddrCity(e.target.value)}
          required
        />
        <FormInput
          label="District"
          value={addrDistrict}
          onChange={(e) => setAddrDistrict(e.target.value)}
          required
        />
        <FormSelect
          label="State"
          value={addrState}
          onChange={(e) => setAddrState(e.target.value)}
          required
        >
          <option value="">— Select a state —</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="PIN code"
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit PIN code"
          value={addrPincode}
          onChange={(e) => setAddrPincode(e.target.value.replace(/\D/g, ""))}
          required
        />

        <SectionHeading>GST &amp; documents</SectionHeading>
        <FormInput
          label="GST Number"
          placeholder="15-character GSTIN"
          value={gstNumber}
          onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
          required
        />
        <div className="hidden sm:block" aria-hidden="true" />
        <FormFileInput
          label="GST Certificate"
          accept={ACCEPT}
          onChange={pickFile(setGstDocFile, "GST certificate")}
          hint="PDF, JPG, PNG, or WEBP — up to 5 MB"
          required
        />
        <FormFileInput
          label="PAN Card"
          accept={ACCEPT}
          onChange={pickFile(setPanDocFile, "PAN card")}
          hint="PDF, JPG, PNG, or WEBP — up to 5 MB"
          required
        />

        <SectionHeading>Bank details</SectionHeading>
        <FormInput
          label="Bank Name"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          required
        />
        <FormInput
          label="Account Holder Name"
          value={accountHolderName}
          onChange={(e) => setAccountHolderName(e.target.value)}
          required
        />
        <FormInput
          label="Account Number"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
          required
        />
        <FormInput
          label="IFSC Code"
          placeholder="e.g. HDFC0001234"
          value={ifscCode}
          onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
          required
        />
        <FormInput
          label="Bank Branch"
          className="sm:col-span-2"
          value={bankBranch}
          onChange={(e) => setBankBranch(e.target.value)}
          required
        />

        {error && (
          <div className="sm:col-span-2">
            <AlertBox tone="danger">{error}</AlertBox>
          </div>
        )}
        {otpStage !== "verified" && (
          <div className="sm:col-span-2">
            <AlertBox tone="info">Verify your mobile number above before submitting.</AlertBox>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            disabled={isPending || otpStage !== "verified"}
            fullWidth
          >
            {isPending ? "Submitting…" : "Submit Application"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
