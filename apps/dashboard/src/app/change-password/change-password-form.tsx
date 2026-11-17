"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormPasswordInput } from "@kisan4u/ui";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    startTransition(async () => {
      const result = await changePasswordAction(newPassword, confirmPassword);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // requireSession's mustChangePassword check re-reads the live DB
      // value on every request, so the very next page load (root page.tsx
      // redirects by role) no longer bounces back here.
      router.push("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
      <FormPasswordInput
        label="New password"
        placeholder="Enter a new password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        hint="At least 8 characters, with uppercase, lowercase, a number, and a special character."
        required
        autoFocus
      />
      <FormPasswordInput
        label="Confirm new password"
        placeholder="Re-enter the new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
      />
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <Button type="submit" variant="primary" disabled={isPending} fullWidth>
        {isPending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
