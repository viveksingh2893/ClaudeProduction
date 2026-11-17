"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { listAddresses } from "@kisan4u/orders";
import { Button, Card, EmptyState } from "@kisan4u/ui";
import { AddressForm } from "./address-form";
import { deleteAddressAction, setDefaultAddressAction } from "./actions";

type Address = Awaited<ReturnType<typeof listAddresses>>[number];

const ADDRESS_TYPE_LABEL: Record<string, string> = {
  HOME: "Home",
  FARM: "Farm",
  SHOP: "Shop",
  OFFICE: "Office",
  OTHER: "Other",
};

export function AddressManager({
  addresses,
  states,
  dealerLockedState,
}: {
  addresses: Address[];
  states: { id: string; name: string }[];
  dealerLockedState: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [isPending, startTransition] = useTransition();

  function close() {
    setEditing(null);
    router.refresh();
  }

  function remove(id: string) {
    if (!confirm("Delete this address?")) return;
    startTransition(async () => {
      await deleteAddressAction(id);
      router.refresh();
    });
  }

  function makeDefault(id: string) {
    startTransition(async () => {
      await setDefaultAddressAction(id);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {addresses.length === 0 && editing !== "new" && (
        <EmptyState title="No saved addresses" description="Add an address to speed up checkout next time." />
      )}

      {addresses.map((address) => {
        if (editing === address.id) {
          return (
            <AddressForm
              key={address.id}
              initial={{
                id: address.id,
                fullName: address.fullName,
                mobile: address.mobile,
                altMobile: address.altMobile ?? "",
                line1: address.line1,
                line2: address.line2 ?? "",
                landmark: address.landmark ?? "",
                cityTown: address.cityTown,
                // Legacy-migrated addresses can have a null district (see
                // migrate-legacy-customers.ts) — falls back to the form's
                // own "" default, same as every other optional field here.
                district: address.district ?? undefined,
                state: address.state,
                stateId: address.stateId ?? undefined,
                pincode: address.pincode,
                addressType: address.addressType,
                isDefault: address.isDefault,
              }}
              states={states}
              dealerLockedState={dealerLockedState}
              onSaved={close}
              onCancel={() => setEditing(null)}
            />
          );
        }
        return (
          <Card key={address.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="font-bold text-ink">{address.fullName}</span>
              <span className="whitespace-nowrap text-xs font-semibold text-gray-600">
                {ADDRESS_TYPE_LABEL[address.addressType] ?? address.addressType}
                {address.isDefault && " · Default"}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
              {address.landmark ? `, near ${address.landmark}` : ""}
              <br />
              {address.cityTown}, {address.district}, {address.state} - {address.pincode}
              <br />
              Mobile: {address.mobile}
              {address.altMobile ? ` / ${address.altMobile}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(address.id)} disabled={isPending}>
                Edit
              </Button>
              {!address.isDefault && (
                <Button type="button" variant="ghost" size="sm" onClick={() => makeDefault(address.id)} disabled={isPending}>
                  Set as Default
                </Button>
              )}
              <Button type="button" variant="danger" size="sm" onClick={() => remove(address.id)} disabled={isPending}>
                Delete
              </Button>
            </div>
          </Card>
        );
      })}

      {editing === "new" ? (
        <AddressForm states={states} dealerLockedState={dealerLockedState} onSaved={close} onCancel={() => setEditing(null)} />
      ) : (
        <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
          + Add New Address
        </Button>
      )}
    </div>
  );
}
