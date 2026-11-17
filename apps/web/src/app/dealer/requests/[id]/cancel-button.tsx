"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button } from "@kisan4u/ui";
import { cancelProductRequestAction } from "../actions";

export function CancelButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelProductRequestAction(requestId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="danger" size="sm" onClick={handleCancel} disabled={isPending}>
        {isPending ? "Cancelling…" : "Cancel Request"}
      </Button>
      {error && <AlertBox tone="danger">{error}</AlertBox>}
    </div>
  );
}
