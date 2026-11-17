"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, UserPlus } from "lucide-react";
import { AlertBox, Button, FormInput, FormSelect, Modal } from "@kisan4u/ui";
import { stateNameFromGstNumber } from "@kisan4u/validators";

export type DealerFormValues = {
  name: string;
  storeName: string;
  storeAddress: string;
  city: string;
  stateId: string;
  pincode: string;
  gstNumber: string;
  licenseNumber: string;
};

const EMPTY: DealerFormValues = {
  name: "",
  storeName: "",
  storeAddress: "",
  city: "",
  stateId: "",
  pincode: "",
  gstNumber: "",
  licenseNumber: "",
};

/**
 * Shared dealer business-details form, used for both "Convert to dealer"
 * (from the customers table / a customer's page) and "Edit dealer
 * details" (from a dealer's page). The parent wires `onSubmit` to the
 * matching server action — adminConvertCustomerToDealerAction or
 * proposeDealerProfileChangesAction — and passes the state list plus any
 * existing values to prefill. GST / licence document copies are handled
 * separately (view + re-upload widgets on the dealer page).
 */
export function DealerFormButton({
  trigger,
  title,
  submitLabel,
  states,
  initial,
  confirmHint,
  onSubmit,
}: {
  trigger: { label: string; icon?: "convert" | "edit"; variant?: "primary" | "outline" };
  title: string;
  submitLabel: string;
  states: { id: string; name: string }[];
  initial?: Partial<DealerFormValues>;
  /** Shown above the submit button — e.g. "This change needs a second approval before it goes live." */
  confirmHint?: string;
  onSubmit: (
    values: DealerFormValues,
  ) => Promise<{ ok: boolean; error?: string; pending?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const Icon = trigger.icon === "convert" ? UserPlus : Pencil;
  return (
    <>
      <Button
        type="button"
        variant={trigger.variant ?? "outline"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Icon className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {trigger.label}
      </Button>
      {open && (
        <DealerFormModal
          title={title}
          submitLabel={submitLabel}
          states={states}
          initial={initial}
          confirmHint={confirmHint}
          onSubmit={onSubmit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DealerFormModal({
  title,
  submitLabel,
  states,
  initial,
  confirmHint,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  states: { id: string; name: string }[];
  initial?: Partial<DealerFormValues>;
  confirmHint?: string;
  onSubmit: (
    values: DealerFormValues,
  ) => Promise<{ ok: boolean; error?: string; pending?: boolean }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<DealerFormValues>({ ...EMPTY, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof DealerFormValues>(key: K, value: DealerFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const derivedStateName =
    form.gstNumber.length === 15 ? stateNameFromGstNumber(form.gstNumber.toUpperCase()) : null;
  const gstMatchedState = derivedStateName
    ? states.find((s) => s.name.toLowerCase() === derivedStateName.toLowerCase())
    : undefined;
  const gstLocked = Boolean(gstMatchedState);

  function handleGst(raw: string) {
    const value = raw.toUpperCase();
    setForm((f) => {
      const next = { ...f, gstNumber: value };
      if (value.length === 15) {
        const name = stateNameFromGstNumber(value);
        const match = name
          ? states.find((s) => s.name.toLowerCase() === name.toLowerCase())
          : undefined;
        if (match) next.stateId = match.id;
      }
      return next;
    });
  }

  function handleSave() {
    setError(null);
    setSaving(true);
    onSubmit(form)
      .then((result) => {
        setSaving(false);
        if (!result.ok) {
          setError(result.error ?? "Something went wrong — try again.");
          return;
        }
        router.refresh();
        onClose();
      })
      .catch(() => {
        setSaving(false);
        setError("Something went wrong — try again.");
      });
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} title={title} className="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput
            label="Full name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
          <FormInput
            label="Store name"
            value={form.storeName}
            onChange={(e) => set("storeName", e.target.value)}
          />
        </div>
        <FormInput
          label="Store address"
          value={form.storeAddress}
          onChange={(e) => set("storeAddress", e.target.value)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput
            label="City"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
          />
          <FormInput
            label="Pincode"
            value={form.pincode}
            onChange={(e) => set("pincode", e.target.value)}
            maxLength={6}
          />
        </div>
        <FormSelect
          label="State"
          value={form.stateId}
          onChange={(e) => set("stateId", e.target.value)}
          disabled={gstLocked}
          hint={
            gstLocked ? `Locked to ${gstMatchedState?.name} from the GST number` : undefined
          }
        >
          <option value="">— Select state —</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FormSelect>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput
            label="GST number (optional)"
            value={form.gstNumber}
            onChange={(e) => handleGst(e.target.value)}
            maxLength={15}
          />
          <FormInput
            label="License number (optional)"
            value={form.licenseNumber}
            onChange={(e) => set("licenseNumber", e.target.value)}
          />
        </div>
        {confirmHint && <AlertBox tone="info">{confirmHint}</AlertBox>}
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button type="button" loading={saving} onClick={handleSave}>
            {submitLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
