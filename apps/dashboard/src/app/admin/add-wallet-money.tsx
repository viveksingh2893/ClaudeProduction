"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormInput, FormTextarea, Modal } from "@kisan4u/ui";
import { adminCreditWalletAction } from "./actions";

/**
 * "Add money" for the Wallet section of the customer / dealer detail page.
 * A manual admin credit — no payment gateway — audited server-side.
 */
export function AddWalletMoney({
  userId,
  role,
  ownerName,
}: {
  userId: string;
  role: "CUSTOMER" | "DEALER";
  ownerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setAmount("");
    setNote("");
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const rupees = Number(amount);
    if (!(rupees > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }
    startTransition(async () => {
      const result = await adminCreditWalletAction(role, { userId, amount: rupees, note: note.trim() || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add money
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title={`Add money to ${ownerName}'s wallet`}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            This credits the wallet directly — no payment is collected. Use it for a goodwill
            credit, to record an offline payment, or a support adjustment. The entry is logged
            against your admin account.
          </p>
          <FormInput
            label="Amount (₹)"
            type="number"
            min={1}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <FormTextarea
            label="Note (optional)"
            hint="Kept in the audit log — e.g. why this credit was given"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          {error && <AlertBox tone="danger">{error}</AlertBox>}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add money"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
