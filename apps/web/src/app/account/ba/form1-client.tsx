"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormSelect } from "@kisan4u/ui";
import { submitBaForm1Action } from "./actions";

type Defaults = {
  firstName: string;
  lastName: string;
  contactNumber: string;
  email: string;
  pincode: string;
  state: string;
  city: string;
};

const FIELDS_BEFORE_STATE: { name: keyof Defaults; label: string; type?: string }[] = [
  { name: "firstName", label: "First name" },
  { name: "lastName", label: "Last name" },
  { name: "contactNumber", label: "Contact number (must match your account)" },
  { name: "email", label: "Email", type: "email" },
  { name: "pincode", label: "Pincode" },
];
const FIELDS_AFTER_STATE: { name: keyof Defaults; label: string; type?: string }[] = [
  { name: "city", label: "City" },
];

export function Form1Client({
  defaults,
  states,
}: {
  defaults: Defaults;
  states: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<Defaults>(defaults);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await submitBaForm1Action(form);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {FIELDS_BEFORE_STATE.map((f) => (
        <div key={f.name}>
          <label className="mb-1 block text-xs font-semibold text-gray-600">{f.label}</label>
          <input
            type={f.type ?? "text"}
            required
            value={form[f.name]}
            onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
            className="w-full rounded-lg border-[1.5px] border-border px-3 py-2 text-sm outline-none focus:border-green-600"
          />
        </div>
      ))}
      <FormSelect
        label="State"
        required
        value={form.state}
        onChange={(e) => setForm((s) => ({ ...s, state: e.target.value }))}
      >
        <option value="">— Select your state —</option>
        {states.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
      </FormSelect>
      {FIELDS_AFTER_STATE.map((f) => (
        <div key={f.name}>
          <label className="mb-1 block text-xs font-semibold text-gray-600">{f.label}</label>
          <input
            type={f.type ?? "text"}
            required
            value={form[f.name]}
            onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
            className="w-full rounded-lg border-[1.5px] border-border px-3 py-2 text-sm outline-none focus:border-green-600"
          />
        </div>
      ))}
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <Button type="submit" variant="secondary" disabled={pending} fullWidth>
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
