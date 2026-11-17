"use client";

import { useState, useTransition } from "react";
import { INDIAN_STATES } from "@kisan4u/validators";
import { savePickupPointAction } from "./actions";

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.5rem",
  marginBottom: "0.75rem",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.85rem", color: "#666" };

export type PickupPointFormValue = {
  id?: string;
  name: string;
  contactPerson: string;
  mobile: string;
  line1: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  landmark?: string | null;
  isDefault: boolean;
};

export function PickupPointForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Partial<PickupPointFormValue>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<PickupPointFormValue>({
    id: initial?.id,
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
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof PickupPointFormValue>(key: K, value: PickupPointFormValue[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await savePickupPointAction(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}
    >
      <label style={labelStyle}>Pickup point name</label>
      <input
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
        required
        style={inputStyle}
      />
      <label style={labelStyle}>Contact person</label>
      <input
        value={values.contactPerson}
        onChange={(e) => set("contactPerson", e.target.value)}
        required
        style={inputStyle}
      />
      <label style={labelStyle}>Mobile number</label>
      <input
        value={values.mobile}
        onChange={(e) => set("mobile", e.target.value)}
        required
        style={inputStyle}
      />
      <label style={labelStyle}>Address</label>
      <input
        value={values.line1}
        onChange={(e) => set("line1", e.target.value)}
        required
        style={inputStyle}
      />
      <label style={labelStyle}>City</label>
      <input
        value={values.city}
        onChange={(e) => set("city", e.target.value)}
        required
        style={inputStyle}
      />
      <label style={labelStyle}>District</label>
      <input
        value={values.district}
        onChange={(e) => set("district", e.target.value)}
        required
        style={inputStyle}
      />
      <label style={labelStyle}>State</label>
      <select
        value={values.state}
        onChange={(e) => set("state", e.target.value)}
        required
        style={inputStyle}
      >
        <option value="">Select a state…</option>
        {INDIAN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label style={labelStyle}>PIN code</label>
      <input
        value={values.pincode}
        onChange={(e) => set("pincode", e.target.value)}
        required
        style={inputStyle}
      />
      <label style={labelStyle}>Landmark (optional)</label>
      <input
        value={values.landmark ?? ""}
        onChange={(e) => set("landmark", e.target.value)}
        style={inputStyle}
      />
      <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={values.isDefault}
          onChange={(e) => set("isDefault", e.target.checked)}
        />
        Set as default pickup point
      </label>
      <p style={{ fontSize: "0.8rem", color: "#666" }}>
        Saving submits this pickup point for admin approval — only approved, active pickup points
        can be selected for dispatch.
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save pickup point"}
      </button>{" "}
      <button type="button" onClick={onCancel} disabled={isPending}>
        Cancel
      </button>
    </form>
  );
}
