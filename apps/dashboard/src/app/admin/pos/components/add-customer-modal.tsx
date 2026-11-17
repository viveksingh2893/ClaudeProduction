"use client";

import { useState, useTransition } from "react";
import { Modal, Button, FormInput, AlertBox } from "@kisan4u/ui";
import { createPosCustomerAction } from "../actions";

export function AddCustomerModal({
  open,
  onClose,
  onCreated,
  onSelectExisting,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (userId: string, label: string) => void;
  onSelectExisting: (userId: string, label: string) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{
    id: string;
    name: string;
    maskedPhone: string | null;
    email: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setError(null);
    setExisting(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExisting(null);
    startTransition(async () => {
      const result = await createPosCustomerAction({
        firstName,
        lastName,
        email: email || undefined,
        phone,
      });
      if (!result.ok) {
        setError(result.error);
        if (result.existingCustomer) setExisting(result.existingCustomer);
        return;
      }
      const label = `${firstName} ${lastName}`.trim();
      reset();
      onCreated(result.userId, label);
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add New Customer"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
          <FormInput
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
          <FormInput
            label="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <FormInput
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <p className="text-xs text-gray-500">
          A delivery address is added on the next step, right after this customer is created.
        </p>

        {error && (
          <AlertBox tone="danger">
            {error}
            {existing && (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onSelectExisting(existing.id, existing.name);
                    reset();
                  }}
                >
                  Select {existing.name} ({existing.maskedPhone ?? existing.email}) instead
                </Button>
              </div>
            )}
          </AlertBox>
        )}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Creating…" : "Create Customer"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
