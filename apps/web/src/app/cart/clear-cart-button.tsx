"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@kisan4u/ui";
import { clearCartAction } from "./actions";

export function ClearCartButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("Clear your entire cart?")) return;
    startTransition(async () => {
      await clearCartAction();
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? "Clearing…" : "Clear cart"}
    </Button>
  );
}
