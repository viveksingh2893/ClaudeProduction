import { Suspense } from "react";
import { AuthCardShell } from "@/components/auth-card-shell";
import { VerifyForm } from "./verify-form";

export default function RegisterDealerVerifyPage() {
  return (
    <AuthCardShell>
      <h1 className="text-xl font-extrabold text-earth-700">Verify Your Mobile Number</h1>
      <Suspense fallback={null}>
        <VerifyForm />
      </Suspense>
    </AuthCardShell>
  );
}
