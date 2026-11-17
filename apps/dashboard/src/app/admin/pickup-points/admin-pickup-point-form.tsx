"use client";

import { useState, useTransition } from "react";
import { AlertBox, Button, FormField, FormInput, FormSelect } from "@kisan4u/ui";
import { INDIAN_STATES } from "@kisan4u/validators";
import { saveAdminPickupPointAction } from "./actions";

export type AdminPickupPointInitial = {
  id: string;
  sellerId: string;
  sellerName: string;
  name: string;
  contactPerson: string;
  mobile: string;
  line1: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  landmark: string | null;
  isDefault: boolean;
  isActive: boolean;
};

type FieldState = {
  name: string;
  contactPerson: string;
  mobile: string;
  line1: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  landmark: string;
  isDefault: boolean;
  isActive: boolean;
};

function initialFieldState(initial?: AdminPickupPointInitial): FieldState {
  return {
    name: initial?.name ?? "",
    contactPerson: initial?.contactPerson ?? "",
    mobile: initial?.mobile ?? "",
    line1: initial?.line1 ?? "",
    city: initial?.city ?? "",
    district: initial?.district ?? "",
    state: initial?.state ?? "",
    pincode: initial?.pincode ?? "",
    landmark: initial?.landmark ?? "",
    isDefault: initial?.isDefault ?? false,
    isActive: initial?.isActive ?? true,
  };
}

/**
 * Admin add / edit form for a seller's pickup point. Add mode picks the
 * seller and can approve on the spot; edit mode keeps the owner fixed and
 * never bounces an approved point back to pending.
 */
export function AdminPickupPointForm({
  sellers,
  initial,
  onSaved,
  onCancel,
}: {
  sellers: { id: string; shopName: string }[];
  initial?: AdminPickupPointInitial;
  onSaved: (warning?: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(initial);
  const [sellerId, setSellerId] = useState(initial?.sellerId ?? "");
  const [approveNow, setApproveNow] = useState(false);
  const [values, setValues] = useState<FieldState>(() => initialFieldState(initial));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof FieldState>(key: K, value: FieldState[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveAdminPickupPointAction({
        id: initial?.id,
        sellerId: isEdit ? initial!.sellerId : sellerId,
        name: values.name,
        contactPerson: values.contactPerson,
        mobile: values.mobile,
        line1: values.line1,
        city: values.city,
        district: values.district,
        state: values.state,
        pincode: values.pincode,
        landmark: values.landmark.trim() || undefined,
        isDefault: values.isDefault,
        isActive: values.isActive,
        approveNow: isEdit ? false : approveNow,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.warning);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {isEdit ? (
        <FormField label="Seller">
          <div className="rounded-md border-[1.5px] border-border bg-bg-dashboard px-3 py-2.5 text-sm text-ink">
            {initial!.sellerName}
          </div>
        </FormField>
      ) : (
        <FormSelect
          label="Seller"
          required
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
        >
          <option value="">Select a seller…</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shopName}
            </option>
          ))}
        </FormSelect>
      )}

      <FormInput
        label="Pickup point name"
        required
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="Contact person"
          required
          value={values.contactPerson}
          onChange={(e) => set("contactPerson", e.target.value)}
        />
        <FormInput
          label="Mobile number"
          required
          inputMode="numeric"
          value={values.mobile}
          onChange={(e) => set("mobile", e.target.value)}
        />
      </div>
      <FormInput
        label="Address"
        required
        value={values.line1}
        onChange={(e) => set("line1", e.target.value)}
      />
      <FormInput
        label="Landmark (optional)"
        value={values.landmark}
        onChange={(e) => set("landmark", e.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormInput
          label="City"
          required
          value={values.city}
          onChange={(e) => set("city", e.target.value)}
        />
        <FormInput
          label="District"
          required
          value={values.district}
          onChange={(e) => set("district", e.target.value)}
        />
        <FormSelect
          label="State"
          required
          value={values.state}
          onChange={(e) => set("state", e.target.value)}
        >
          <option value="">Select a state…</option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="PIN code"
          required
          inputMode="numeric"
          value={values.pincode}
          onChange={(e) => set("pincode", e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={values.isDefault}
          onChange={(e) => set("isDefault", e.target.checked)}
        />
        Set as the seller&apos;s default pickup point
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />
        Active (available for dispatch once approved)
      </label>
      {!isEdit && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={approveNow}
            onChange={(e) => setApproveNow(e.target.checked)}
          />
          Approve immediately (skips the pending queue; registers with Delhivery)
        </label>
      )}

      {error && <AlertBox tone="danger">{error}</AlertBox>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Add pickup point"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
