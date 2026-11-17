"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button } from "@kisan4u/ui";
import { decideProposedOrderAction } from "../../actions";

export function DecideClient({ proposedOrderId }: { proposedOrderId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(decision: "APPROVE" | "REJECT" | "CUSTOMIZE") {
    setError(null);
    start(async () => {
      const res = await decideProposedOrderAction({ proposedOrderId, decision });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (decision === "CUSTOMIZE") router.push("/cart");
      else if (decision === "APPROVE") router.push("/orders");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={pending} onClick={() => decide("APPROVE")}>
          Approve &amp; place (COD)
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => decide("CUSTOMIZE")}>
          Customize in cart
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => decide("REJECT")}>
          Decline
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Choosing “Customize” moves these items to your cart so you can edit them and pay with any
        method.
      </p>
    </div>
  );
}
