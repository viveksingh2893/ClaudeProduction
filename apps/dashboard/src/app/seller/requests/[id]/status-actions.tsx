"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button } from "@kisan4u/ui";
import { updateRequestStatusAction } from "../actions";

export function RequestStatusActions({ requestId, status }: { requestId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function act(next: "VIEWED" | "RESPONDED" | "CLOSED") {
    setError(null);
    startTransition(async () => {
      const result = await updateRequestStatusAction(requestId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const canClose = status !== "CLOSED" && status !== "CANCELLED";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "APPROVED" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => act("VIEWED")}
            disabled={isPending}
          >
            Mark viewed
          </Button>
        )}
        {(status === "APPROVED" || status === "VIEWED") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => act("RESPONDED")}
            disabled={isPending}
          >
            Mark responded
          </Button>
        )}
        {canClose && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => act("CLOSED")}
            disabled={isPending}
          >
            Close request
          </Button>
        )}
      </div>
      {error && <AlertBox tone="danger">{error}</AlertBox>}
    </div>
  );
}
