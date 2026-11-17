"use client";

import { signOut } from "next-auth/react";
import { Button } from "@kisan4u/ui";

export function SignOutButton() {
  return (
    <Button variant="outline" size="sm" fullWidth onClick={() => signOut({ callbackUrl: "/login" })} className="!border-white/20 !bg-transparent !text-green-100 hover:!bg-green-800">
      Sign out
    </Button>
  );
}
