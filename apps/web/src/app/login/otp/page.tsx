import { Suspense } from "react";
import { AuthCardShell } from "@/components/auth-card-shell";
import { OtpForm } from "./otp-form";

export default function LoginOtpPage() {
  return (
    <AuthCardShell>
      <h1 className="text-xl font-extrabold text-green-800">Enter the OTP</h1>
      <Suspense fallback={null}>
        <OtpForm />
      </Suspense>
    </AuthCardShell>
  );
}
