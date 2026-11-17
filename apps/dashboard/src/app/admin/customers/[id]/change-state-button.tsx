"use client";

import { useState } from "react";
import { Button } from "@kisan4u/ui";
import { MapPin } from "lucide-react";
import { ChangeCustomerStateModal } from "../change-customer-state-modal";

export function ChangeStateButton({
  customerId,
  customerName,
  currentStateName,
  states,
}: {
  customerId: string;
  customerName: string;
  currentStateName: string | null;
  states: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MapPin className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Change state
      </Button>
      {open && (
        <ChangeCustomerStateModal
          customerId={customerId}
          customerName={customerName}
          currentStateName={currentStateName}
          states={states}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
