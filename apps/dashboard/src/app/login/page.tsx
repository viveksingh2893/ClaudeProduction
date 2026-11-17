"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertBox, Button, FormInput, FormPasswordInput } from "@kisan4u/ui";

export default function DashboardLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signIn("password", { email, password, redirect: false });
      if (result?.error) {
        setError("Invalid email or password");
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-dashboard px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-surface p-7 sm:p-9">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-green-700">
          <span className="h-5 w-5 rounded-md border-[3px] border-white" />
        </div>
        <h1 className="text-xl font-extrabold text-green-800">Dashboard Login</h1>
        <p className="mt-1 text-sm text-gray-600">Admin and seller accounts sign in here.</p>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <FormInput label="Email Address" type="email" placeholder="you@kisan4u.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <FormPasswordInput label="Password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <Button type="submit" variant="primary" disabled={isPending} fullWidth>
            {isPending ? "Signing in…" : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
