"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal, Button, FormInput, FormSelect, AlertBox } from "@kisan4u/ui";
import {
  addPosAddressAction,
  updatePosAddressAction,
  listPosIndianStatesAction,
} from "../actions";

export type PosAddressFormValue = {
  id?: string;
  fullName: string;
  mobile: string;
  altMobile: string;
  line1: string;
  line2: string;
  landmark: string;
  cityTown: string;
  district: string;
  state: string;
  stateId: string;
  pincode: string;
  addressType: "HOME" | "FARM" | "SHOP" | "OFFICE" | "OTHER";
  isDefault: boolean;
};

const EMPTY: PosAddressFormValue = {
  fullName: "",
  mobile: "",
  altMobile: "",
  line1: "",
  line2: "",
  landmark: "",
  cityTown: "",
  district: "",
  state: "",
  stateId: "",
  pincode: "",
  addressType: "HOME",
  isDefault: false,
};

/**
 * POS's own address-add/edit form — the same underlying schema/service
 * (customerAddressInputSchema / createAddress, via addPosAddressAction)
 * as every other address form in the app, just rebuilt as a component
 * here since apps/web's AddressForm is app-local (hardcoded to its own
 * session-scoped server action) and can't be imported cross-app. Locks
 * State exactly like AddressForm does when `dealerLockedState` is set.
 */
export function AddressFormModal({
  open,
  onClose,
  targetUserId,
  dealerLockedState,
  initial,
  editAddressId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  targetUserId: string;
  dealerLockedState: { id: string; name: string } | null;
  initial?: Partial<PosAddressFormValue>;
  /** When set, the modal edits this existing saved address instead of adding a new one. */
  editAddressId?: string;
  onSaved: (addressId: string) => void;
}) {
  const isEdit = Boolean(editAddressId);
  const [values, setValues] = useState<PosAddressFormValue>({
    ...EMPTY,
    ...initial,
    state: dealerLockedState ? dealerLockedState.name : (initial?.state ?? ""),
    stateId: dealerLockedState ? dealerLockedState.id : (initial?.stateId ?? ""),
  });
  const [states, setStates] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || dealerLockedState) return;
    listPosIndianStatesAction().then((result) => {
      if (result.ok) setStates(result.data);
    });
  }, [open, dealerLockedState]);

  useEffect(() => {
    if (!open) return;
    setValues({
      ...EMPTY,
      ...initial,
      state: dealerLockedState ? dealerLockedState.name : (initial?.state ?? ""),
      stateId: dealerLockedState ? dealerLockedState.id : (initial?.stateId ?? ""),
    });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed when the modal (re-)opens
  }, [open]);

  function set<K extends keyof PosAddressFormValue>(key: K, value: PosAddressFormValue[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        ...values,
        ...(editAddressId ? { id: editAddressId } : {}),
        altMobile: values.altMobile || undefined,
        line2: values.line2 || undefined,
        landmark: values.landmark || undefined,
        stateId: values.stateId || undefined,
      };
      const result = isEdit
        ? await updatePosAddressAction(targetUserId, payload)
        : await addPosAddressAction(targetUserId, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data.addressId);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Address" : "Add Address"}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="Recipient / store name"
            value={values.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            required
          />
          <FormInput
            label="Mobile number"
            value={values.mobile}
            onChange={(e) => set("mobile", e.target.value)}
            required
          />
          <FormInput
            label="Alternate mobile (optional)"
            value={values.altMobile}
            onChange={(e) => set("altMobile", e.target.value)}
          />
          <FormInput
            label="Address line 1"
            className="sm:col-span-2"
            value={values.line1}
            onChange={(e) => set("line1", e.target.value)}
            required
          />
          <FormInput
            label="Address line 2 (optional)"
            className="sm:col-span-2"
            value={values.line2}
            onChange={(e) => set("line2", e.target.value)}
          />
          <FormInput
            label="Landmark (optional)"
            className="sm:col-span-2"
            value={values.landmark}
            onChange={(e) => set("landmark", e.target.value)}
          />
          <FormInput
            label="Village, town or city"
            value={values.cityTown}
            onChange={(e) => set("cityTown", e.target.value)}
            required
          />
          <FormInput
            label="District"
            value={values.district}
            onChange={(e) => set("district", e.target.value)}
            required
          />
          {dealerLockedState ? (
            <FormInput
              label="State"
              value={dealerLockedState.name}
              readOnly
              disabled
              hint="Locked to the dealer's verified state."
            />
          ) : (
            <FormSelect
              label="State"
              value={values.stateId}
              onChange={(e) => {
                const s = states.find((state) => state.id === e.target.value);
                set("stateId", s?.id ?? "");
                set("state", s?.name ?? "");
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
          <FormInput
            label="PIN code"
            value={values.pincode}
            onChange={(e) => set("pincode", e.target.value)}
            required
          />
          <FormSelect
            label="Address type"
            value={values.addressType}
            onChange={(e) =>
              set("addressType", e.target.value as PosAddressFormValue["addressType"])
            }
          >
            {(["HOME", "FARM", "SHOP", "OFFICE", "OTHER"] as const).map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </FormSelect>
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold text-gray-600">
          <input
            type="checkbox"
            checked={values.isDefault}
            onChange={(e) => set("isDefault", e.target.checked)}
          />
          Set as default address
        </label>

        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Save Address"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
