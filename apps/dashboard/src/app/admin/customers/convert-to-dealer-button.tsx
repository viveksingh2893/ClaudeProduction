"use client";

import { adminConvertCustomerToDealerAction } from "../actions";
import { DealerFormButton, type DealerFormValues } from "../dealer-form-modal";

export type CustomerDealerApplicationStatus =
  | "NONE"
  | "PENDING"
  | "REJECTED"
  | "APPROVED"
  | "SUSPENDED"
  | "INACTIVE";

/**
 * "Convert to dealer" for a customer row / page. Opens the dealer
 * application form; on submit a PENDING DealerProfile is attached to the
 * customer's account and stays pending until it's approved from the
 * Dealers list. If the customer already has a PENDING / REJECTED
 * application the button instead edits that application in place.
 * An already-approved / suspended dealer account shows nothing (it has
 * left the customers table by then anyway).
 */
export function ConvertToDealerButton({
  userId,
  customerName,
  states,
  applicationStatus = "NONE",
  prefill,
  variant = "outline",
}: {
  userId: string;
  customerName: string;
  states: { id: string; name: string }[];
  applicationStatus?: CustomerDealerApplicationStatus;
  prefill?: Partial<DealerFormValues>;
  variant?: "primary" | "outline";
}) {
  if (
    applicationStatus === "APPROVED" ||
    applicationStatus === "SUSPENDED" ||
    applicationStatus === "INACTIVE"
  ) {
    return null;
  }

  const editing = applicationStatus === "PENDING" || applicationStatus === "REJECTED";

  return (
    <DealerFormButton
      trigger={{
        label: editing ? "Edit dealer application" : "Convert to dealer",
        icon: "convert",
        variant,
      }}
      title={editing ? `Edit dealer application — ${customerName}` : `Convert ${customerName} to a dealer`}
      submitLabel={editing ? "Save application" : "Create pending dealer application"}
      states={states}
      initial={{ name: customerName, ...prefill }}
      confirmHint={
        editing
          ? "The application stays pending until it's approved from the Dealers list."
          : "This creates a PENDING dealer application. The customer keeps their customer account and catalogue until you approve it in the Dealers list."
      }
      onSubmit={(values) => adminConvertCustomerToDealerAction({ userId, ...values })}
    />
  );
}
