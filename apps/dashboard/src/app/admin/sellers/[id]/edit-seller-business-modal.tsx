"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { AlertBox, Button, FormInput, FormTextarea, Modal } from "@kisan4u/ui";
import { adminUpdateSellerProfileAction } from "../../actions";

type SellerBusinessProps = {
  profileId: string;
  companyName: string;
  contactPersonName: string | null;
  companyWebsite: string | null;
  registeredAddress: string | null;
  contactEmail: string | null;
  contactMobile: string | null;
  gstNumber: string | null;
  panNumber: string | null;
  bankName: string | null;
  accountHolder: string | null;
  accountNumber: string | null;
  ifscCode: string | null;
  bankBranch: string | null;
  sellingStateIds: string[];
  allStates: Array<{ id: string; name: string }>;
};

export function EditSellerBusinessButton(props: SellerBusinessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Edit
      </Button>
      {open && <EditSellerBusinessModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditSellerBusinessModal({
  profileId,
  companyName,
  contactPersonName,
  companyWebsite,
  registeredAddress,
  contactEmail,
  contactMobile,
  gstNumber,
  panNumber,
  bankName,
  accountHolder,
  accountNumber,
  ifscCode,
  bankBranch,
  sellingStateIds,
  allStates,
  onClose,
}: SellerBusinessProps & { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    companyName: companyName ?? "",
    contactPersonName: contactPersonName ?? "",
    companyWebsite: companyWebsite ?? "",
    registeredAddress: registeredAddress ?? "",
    contactEmail: contactEmail ?? "",
    contactMobile: contactMobile ?? "",
    gstNumber: gstNumber ?? "",
    panNumber: panNumber ?? "",
    bankName: bankName ?? "",
    accountHolderName: accountHolder ?? "",
    accountNumber: accountNumber ?? "",
    ifscCode: ifscCode ?? "",
    bankBranch: bankBranch ?? "",
  });
  const [stateIds, setStateIds] = useState<string[]>(sellingStateIds);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function toggleState(id: string) {
    setStateIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function handleSave() {
    setError(null);
    setSaving(true);
    adminUpdateSellerProfileAction({ profileId, sellingStateIds: stateIds, ...form })
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
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title="Edit seller details"
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Company</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput
            label="Company name"
            value={form.companyName}
            onChange={(e) => set("companyName", e.target.value)}
          />
          <FormInput
            label="Contact person"
            value={form.contactPersonName}
            onChange={(e) => set("contactPersonName", e.target.value)}
          />
          <FormInput
            label="Company website"
            placeholder="https://…"
            value={form.companyWebsite}
            onChange={(e) => set("companyWebsite", e.target.value)}
          />
          <FormInput
            label="Contact email"
            type="email"
            placeholder="name@company.com"
            value={form.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
          />
          <FormInput
            label="Contact mobile"
            inputMode="numeric"
            value={form.contactMobile}
            onChange={(e) => set("contactMobile", e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <p className="-mt-1 text-xs text-gray-500">
          Business contact for this seller — separate from the account&rsquo;s sign-in email and
          phone (edit those from &ldquo;Edit account details&rdquo; above).
        </p>
        <FormTextarea
          label="Registered address"
          rows={2}
          value={form.registeredAddress}
          onChange={(e) => set("registeredAddress", e.target.value)}
        />

        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-gray-500">
          States to sell in
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {allStates.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={stateIds.includes(s.id)}
                onChange={() => toggleState(s.id)}
                className="h-4 w-4 rounded border-border text-green-600 focus:ring-green-500"
              />
              {s.name}
            </label>
          ))}
        </div>

        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-gray-500">GST &amp; bank</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormInput
            label="GST number"
            value={form.gstNumber}
            onChange={(e) => set("gstNumber", e.target.value.toUpperCase())}
          />
          <FormInput
            label="PAN card number"
            value={form.panNumber}
            onChange={(e) => set("panNumber", e.target.value.toUpperCase())}
          />
          <FormInput
            label="Bank name"
            value={form.bankName}
            onChange={(e) => set("bankName", e.target.value)}
          />
          <FormInput
            label="Account holder name"
            value={form.accountHolderName}
            onChange={(e) => set("accountHolderName", e.target.value)}
          />
          <FormInput
            label="Account number"
            inputMode="numeric"
            value={form.accountNumber}
            onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, ""))}
          />
          <FormInput
            label="IFSC code"
            value={form.ifscCode}
            onChange={(e) => set("ifscCode", e.target.value.toUpperCase())}
          />
          <FormInput
            label="Bank branch"
            value={form.bankBranch}
            onChange={(e) => set("bankBranch", e.target.value)}
          />
        </div>
        <p className="text-xs text-gray-500">
          The GST certificate and PAN card uploaded by the seller are view-only here.
        </p>

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
