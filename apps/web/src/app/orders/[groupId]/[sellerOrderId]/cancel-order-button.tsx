"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormSelect, FormTextarea } from "@kisan4u/ui";
import { cancelOrderNowAction, requestCancellationAction } from "./actions";

type CancellationRefundMethod = "WALLET" | "ORIGINAL_SOURCE";

export function CancelOrderButton({
  sellerOrderId,
  nonWalletPaid,
  instant = false,
}: {
  sellerOrderId: string;
  /** Real, non-wallet money already captured for this order — only when this is > 0 does cancelling actually leave something to refund, so the method picker only shows then (nothing to ask for an unpaid COD order or a fully wallet-funded one). */
  nonWalletPaid: number;
  /** True while the order is still "Pending" — cancelling is immediate (no admin approval). False once CONFIRMED — it becomes a request the team reviews. */
  instant?: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const needsRefundMethod = nonWalletPaid > 0.01;
  const [refundMethod, setRefundMethod] = useState<CancellationRefundMethod>("WALLET");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!showForm) {
    return (
      <Button type="button" variant="danger" size="sm" onClick={() => setShowForm(true)}>
        {instant ? "Cancel order" : "Request cancellation"}
      </Button>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        sellerOrderId,
        reason,
        ...(needsRefundMethod ? { refundMethod } : {}),
      };
      const result = instant
        ? await cancelOrderNowAction(payload)
        : await requestCancellationAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setShowForm(false);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-danger/25 bg-danger-bg/40 p-4"
    >
      <FormTextarea
        label="Reason for cancellation"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={3}
        rows={3}
      />
      {needsRefundMethod && (
        <FormSelect
          label={`Refund your ₹${nonWalletPaid.toFixed(2)} already paid to`}
          value={refundMethod}
          onChange={(e) => setRefundMethod(e.target.value as CancellationRefundMethod)}
        >
          <option value="WALLET">Kisan4U Wallet</option>
          <option value="ORIGINAL_SOURCE">Same account I paid with</option>
        </FormSelect>
      )}
      {instant && needsRefundMethod && (
        <p className="text-xs text-gray-600">
          Your order is cancelled right away and the refund is sent to your chosen destination
          automatically.
        </p>
      )}
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={isPending}>
          {isPending ? "Cancelling…" : instant ? "Cancel order now" : "Submit cancellation request"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowForm(false)}
          disabled={isPending}
        >
          Never mind
        </Button>
      </div>
    </form>
  );
}
