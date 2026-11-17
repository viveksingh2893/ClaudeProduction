"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FormInput } from "@kisan4u/ui";
import { setSellerCommissionAction } from "./actions";

/**
 * Admin-editable commission rates for one seller. The two rates are
 * independent: `commissionPercent` applies whenever the buyer is a
 * CUSTOMER (customer), `dealerCommissionPercent` whenever the buyer is a
 * DEALER — matching `SellerOrder.customerType`, so the same seller can be
 * charged e.g. 10% on customer orders and 5% on dealer orders. On a ₹100
 * order this means the seller keeps ₹90 for a customer sale and ₹95 for
 * a dealer sale at those rates.
 */
export function SellerCommissionForm({
  profileId,
  initialCommissionPercent,
  initialDealerCommissionPercent,
}: {
  profileId: string;
  initialCommissionPercent: number;
  initialDealerCommissionPercent: number;
}) {
  const router = useRouter();
  const [commissionPercent, setCommissionPercent] = useState(String(initialCommissionPercent));
  const [dealerCommissionPercent, setDealerCommissionPercent] = useState(
    String(initialDealerCommissionPercent),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const unchanged =
    Number(commissionPercent) === initialCommissionPercent &&
    Number(dealerCommissionPercent) === initialDealerCommissionPercent;

  function handleSave() {
    setError(null);
    setSuccess(false);
    const customerVal = Number(commissionPercent);
    const dealerVal = Number(dealerCommissionPercent);
    if (!Number.isFinite(customerVal) || customerVal < 0 || customerVal > 100) {
      setError("Customer commission must be between 0 and 100.");
      return;
    }
    if (!Number.isFinite(dealerVal) || dealerVal < 0 || dealerVal > 100) {
      setError("Dealer commission must be between 0 and 100.");
      return;
    }
    startTransition(async () => {
      const result = await setSellerCommissionAction(profileId, customerVal, dealerVal);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          label="Customer commission (%)"
          hint="Charged on orders from customers (customers)"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={commissionPercent}
          onChange={(e) => {
            setCommissionPercent(e.target.value);
            setSuccess(false);
          }}
        />
        <FormInput
          label="Dealer commission (%)"
          hint="Charged on orders from dealers"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={dealerCommissionPercent}
          onChange={(e) => {
            setDealerCommissionPercent(e.target.value);
            setSuccess(false);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={handleSave}
          loading={isPending}
          disabled={unchanged}
        >
          Save commission rates
        </Button>
        {success && <span className="text-xs font-semibold text-success">Saved.</span>}
      </div>
      {error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
