"use client";

import { signOut } from "next-auth/react";
import { Button } from "@kisan4u/ui";

export function SignOutButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
      Sign out
    </Button>
  );
}
