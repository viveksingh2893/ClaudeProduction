"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FormInput } from "@kisan4u/ui";
import { createWalletTopupOrderAction, verifyWalletTopupAction } from "./actions";

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; contact?: string };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

// Razorpay requires the Checkout widget be loaded from their domain — injected on demand.
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export function TopUpForm({
  prefillName,
  prefillContact,
}: {
  prefillName?: string;
  prefillContact?: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startTopup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const rupees = Number(amount);
    if (!(rupees > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }

    startTransition(async () => {
      const created = await createWalletTopupOrderAction({ amount: rupees });
      if (!created.ok) {
        setError(created.error);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        setError("Couldn't load the payment window. Check your connection and try again.");
        return;
      }

      const rzp = new window.Razorpay({
        key: created.keyId,
        amount: created.amountPaise,
        currency: "INR",
        order_id: created.razorpayOrderId,
        name: "Kisan4U Wallet",
        description: "Add money to wallet",
        prefill: { name: prefillName || undefined, contact: prefillContact || undefined },
        handler: (response) => {
          startTransition(async () => {
            const verify = await verifyWalletTopupAction({
              topupId: created.topupId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            if (!verify.ok) {
              setError(
                `Payment received but couldn't be confirmed automatically (${verify.error}). Your balance will update shortly.`,
              );
              router.refresh();
              return;
            }
            setAmount("");
            setSuccess(`₹${rupees.toFixed(2)} added. New balance: ₹${verify.balance.toFixed(2)}.`);
            router.refresh();
          });
        },
        modal: {
          ondismiss: () => {
            setError("Top-up cancelled — no money was added.");
          },
        },
      });
      rzp.open();
    });
  }

  return (
    <form onSubmit={startTopup} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {QUICK_AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAmount(String(a))}
            className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
              Number(amount) === a
                ? "border-green-700 bg-green-50 text-green-800"
                : "border-border text-ink hover:bg-gray-50"
            }`}
          >
            ₹{a.toLocaleString("en-IN")}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <FormInput
          label="Amount (₹)"
          type="number"
          min={1}
          step="1"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={isPending || !amount}>
          {isPending ? "Processing…" : "Add money"}
        </Button>
      </div>
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      {success && <p className="text-sm font-medium text-success">{success}</p>}
    </form>
  );
}
