"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { AlertBox, Button, FormInput, Modal } from "@kisan4u/ui";
import { adminUpdateUserDetailsAction } from "./actions";

/** Trigger + modal, self-contained like ChangeStateButton — drop this into any account header. */
export function EditDetailsButton(props: {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Edit details
      </Button>
      {open && <EditAccountDetailsModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Shared "Edit details" form for the customer/dealer/seller account row's own name/phone/email — same fields regardless of role, since they all live on User. */
export function EditAccountDetailsModal({
  userId,
  firstName,
  lastName,
  email,
  phone,
  onClose,
}: {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    email: email ?? "",
    phone: phone ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSave() {
    setError(null);
    setSaving(true);
    adminUpdateUserDetailsAction({ userId, ...form })
      .then((result) => {
        setSaving(false);
        if (!result.ok) {
          setError(result.error);
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
    <Modal open onClose={saving ? () => {} : onClose} title="Edit account details" className="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="First name"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
          />
          <FormInput
            label="Last name"
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
          />
        </div>
        <FormInput
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
        <FormInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button type="button" loading={saving} onClick={handleSave}>
            Save changes
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
