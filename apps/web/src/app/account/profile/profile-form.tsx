"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button, FormInput } from "@kisan4u/ui";
import { updateProfileAction } from "./actions";

export function ProfileForm({
  initialFirstName,
  initialLastName,
}: {
  initialFirstName: string;
  initialLastName: string;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfileAction({ firstName, lastName });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFirstName(result.firstName);
      setLastName(result.lastName ?? "");
      setSaved(true);
      // Re-issues the session cookie with the new name (see the
      // trigger==="update" branch in packages/auth/src/shared.ts) —
      // without this, the site-wide header/greeting would keep showing
      // the old name until next login, since it comes from the JWT, not
      // a fresh DB read.
      await update({ firstName: result.firstName, lastName: result.lastName });
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <FormInput
        label="First name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        maxLength={60}
        required
      />
      <FormInput
        label="Last name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        maxLength={60}
      />
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      {saved && !error && <p className="text-sm font-medium text-success">Saved.</p>}
      <Button type="submit" variant="primary" disabled={isPending || !firstName.trim()}>
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
