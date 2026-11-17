"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { Button } from "@kisan4u/ui";
import {
  LOGISTICS_PARTNERS,
  type LogisticsPartnerKey,
  type DelhiveryAccountKey,
} from "@/lib/logistics-partners";
import { LogisticsWizardModal, type WizardPickupPoint, type WizardOrderAddress } from "./logistics-wizard-modal";

type SubmitResult = { ok: true } | { ok: false; error: string };

export type DispatchWizardInput = {
  sellerOrderId: string;
  partner: LogisticsPartnerKey;
  pickupPointId: string;
  delhiveryAccount?: DelhiveryAccountKey;
  packageLengthCm: number;
  packageBreadthCm: number;
  packageHeightCm: number;
  packageWeightGrams: number;
};

/**
 * The "Create Shipment" wizard's launcher — an icon button in the order
 * tables' Actions column (variant "icon") or a labelled button on the
 * order detail pages (variant "button"), shown only while the order is
 * CONFIRMED. `loadPickupPoints` and `submit` are the caller's own
 * (admin- or seller-scoped) server actions.
 */
export function DispatchWizardLauncher({
  sellerOrderId,
  orderNumber,
  paymentMethod,
  codAmount,
  variant = "icon",
  loadPickupPoints,
  submit,
  loadAddress,
  updateAddress,
}: {
  sellerOrderId: string;
  orderNumber: string;
  paymentMethod: string;
  /** The order's own collectable-on-delivery amount (only meaningful when paymentMethod is COD) — shown read-only in the wizard's Payment panel, never editable there since it comes straight from the order. Omit where the caller doesn't have it handy (COD amount just won't be shown). */
  codAmount?: number;
  variant?: "icon" | "button";
  loadPickupPoints: (sellerOrderId: string) => Promise<WizardPickupPoint[]>;
  submit: (input: DispatchWizardInput) => Promise<SubmitResult>;
  /** Admin-only: pass both to enable the wizard's "Delivery Address" view/edit section. Leave both undefined for the seller-facing wizard. */
  loadAddress?: (sellerOrderId: string) => Promise<WizardOrderAddress | null>;
  updateAddress?: (input: { sellerOrderId: string; fullName: string; mobile: string; altMobile: string; line1: string; line2: string; landmark: string; cityTown: string; district: string; state: string; pincode: string }) => Promise<SubmitResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          title="Create shipment"
          onClick={() => setOpen(true)}
          className="inline-flex items-center rounded-md p-1.5 text-gray-500 transition-colors hover:bg-green-50 hover:text-green-700"
        >
          <Truck className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
          Create shipment
        </Button>
      )}
      <LogisticsWizardModal
        open={open}
        onClose={() => setOpen(false)}
        orderNumber={orderNumber}
        sellerOrderId={sellerOrderId}
        paymentMethod={paymentMethod}
        codAmount={codAmount}
        partners={LOGISTICS_PARTNERS}
        loadPickupPoints={loadPickupPoints}
        submit={submit}
        onDone={() => router.refresh()}
        loadAddress={loadAddress}
        updateAddress={updateAddress}
      />
    </>
  );
}
