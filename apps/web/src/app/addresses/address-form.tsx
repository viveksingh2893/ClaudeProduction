"use client";

import { useState, useTransition } from "react";
import { AlertBox, Button, Card, FormInput, FormSelect } from "@kisan4u/ui";
import { saveAddressAction } from "./actions";

export type AddressFormValue = {
  id?: string;
  fullName: string;
  mobile: string;
  altMobile?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  cityTown: string;
  district: string;
  state: string;
  stateId?: string;
  pincode: string;
  addressType: "HOME" | "FARM" | "SHOP" | "OFFICE" | "OTHER";
  isDefault: boolean;
};

export function AddressForm({
  initial,
  states,
  dealerLockedState,
  onSaved,
  onCancel,
}: {
  initial?: Partial<AddressFormValue>;
  states: { id: string; name: string }[];
  dealerLockedState: { id: string; name: string } | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<AddressFormValue>({
    id: initial?.id,
    fullName: initial?.fullName ?? "",
    mobile: initial?.mobile ?? "",
    altMobile: initial?.altMobile ?? "",
    line1: initial?.line1 ?? "",
    line2: initial?.line2 ?? "",
    landmark: initial?.landmark ?? "",
    cityTown: initial?.cityTown ?? "",
    district: initial?.district ?? "",
    state: dealerLockedState ? dealerLockedState.name : (initial?.state ?? ""),
    stateId: dealerLockedState ? dealerLockedState.id : initial?.stateId,
    pincode: initial?.pincode ?? "",
    addressType: initial?.addressType ?? "HOME",
    isDefault: initial?.isDefault ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof AddressFormValue>(key: K, value: AddressFormValue[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveAddressAction(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <Card className="p-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput label="Full name" value={values.fullName} onChange={(e) => set("fullName", e.target.value)} required />
          <FormInput label="Mobile number" value={values.mobile} onChange={(e) => set("mobile", e.target.value)} required />
          <FormInput label="Alternate mobile (optional)" value={values.altMobile} onChange={(e) => set("altMobile", e.target.value)} />
          <FormInput label="Address line 1" value={values.line1} onChange={(e) => set("line1", e.target.value)} required />
          <FormInput label="Address line 2 (optional)" value={values.line2} onChange={(e) => set("line2", e.target.value)} />
          <FormInput label="Landmark (optional)" value={values.landmark} onChange={(e) => set("landmark", e.target.value)} />
          <FormInput label="Village, town or city" value={values.cityTown} onChange={(e) => set("cityTown", e.target.value)} required />
          <FormInput label="District" value={values.district} onChange={(e) => set("district", e.target.value)} required />
          {dealerLockedState ? (
            <FormInput label="State" value={dealerLockedState.name} readOnly disabled hint="Locked to your verified dealer state — this cannot be changed here." />
          ) : (
            <FormSelect
              label="State"
              value={values.stateId ?? ""}
              onChange={(e) => {
                const state = states.find((s) => s.id === e.target.value);
                set("stateId", state?.id);
                set("state", state?.name ?? "");
              }}
              required
            >
              <option value="">— Select a state —</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </FormSelect>
          )}
          <FormInput label="PIN code" value={values.pincode} onChange={(e) => set("pincode", e.target.value)} required />
          <FormSelect label="Address type" value={values.addressType} onChange={(e) => set("addressType", e.target.value as AddressFormValue["addressType"])}>
            <option value="HOME">Home</option>
            <option value="FARM">Farm</option>
            <option value="SHOP">Shop</option>
            <option value="OFFICE">Office</option>
            <option value="OTHER">Other</option>
          </FormSelect>
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold text-gray-600">
          <input type="checkbox" checked={values.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
          Set as default address
        </label>

        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : "Save Address"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
