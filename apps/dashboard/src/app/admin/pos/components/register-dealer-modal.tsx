"use client";

import { useEffect, useState, useTransition } from "react";
import { stateNameFromGstNumber } from "@kisan4u/validators";
import { Modal, Button, FormInput, FormSelect, FormFileInput, AlertBox } from "@kisan4u/ui";
import {
  registerPosDealerAction,
  uploadPosDealerDocumentAction,
  listPosIndianStatesAction,
} from "../actions";

const EMPTY = {
  firstName: "",
  lastName: "",
  phone: "",
  storeName: "",
  storeAddress: "",
  city: "",
  stateId: "",
  pincode: "",
  gstNumber: "",
  licenseNumber: "",
};

/**
 * POS's "Register New Dealer" (spec §8). Reuses registerPosDealerAction
 * (which itself reuses registerDealer() unchanged) — this modal is purely
 * presentational plumbing: it never approves anything, and after
 * submission the new dealer stays PENDING and is NOT auto-selected —
 * spec §8: "Do not add the pending dealer to the selectable dealer list."
 */
export function RegisterDealerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [values, setValues] = useState(EMPTY);
  const [gstDocUrl, setGstDocUrl] = useState("");
  const [licenseDocUrl, setLicenseDocUrl] = useState("");
  const [uploadingGst, setUploadingGst] = useState(false);
  const [uploadingLicense, setUploadingLicense] = useState(false);
  const [gstError, setGstError] = useState<string | null>(null);
  const [states, setStates] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const gstLocked = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
    values.gstNumber.trim().toUpperCase(),
  );

  useEffect(() => {
    if (!open) return;
    listPosIndianStatesAction().then((result) => {
      if (result.ok) setStates(result.data);
    });
  }, [open]);

  useEffect(() => {
    const gst = values.gstNumber.trim().toUpperCase();
    if (gst.length !== 15) {
      setGstError(null);
      return;
    }
    const derivedName = stateNameFromGstNumber(gst);
    if (!derivedName) {
      setGstError("This doesn't look like a valid GSTIN — check the digits and try again.");
      return;
    }
    setGstError(null);
    const match = states.find((s) => s.name === derivedName);
    if (match) setValues((v) => ({ ...v, stateId: match.id }));
  }, [values.gstNumber, states]);

  function reset() {
    setValues(EMPTY);
    setGstDocUrl("");
    setLicenseDocUrl("");
    setGstError(null);
    setError(null);
    setSubmitted(false);
  }

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleUpload(file: File, kind: "gst" | "license") {
    const formData = new FormData();
    formData.set("file", file);
    if (kind === "gst") setUploadingGst(true);
    else setUploadingLicense(true);
    const result = await uploadPosDealerDocumentAction(formData);
    if (kind === "gst") setUploadingGst(false);
    else setUploadingLicense(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (kind === "gst") setGstDocUrl(result.data.url);
    else setLicenseDocUrl(result.data.url);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await registerPosDealerAction({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        storeName: values.storeName,
        storeAddress: values.storeAddress,
        city: values.city,
        stateId: values.stateId,
        pincode: values.pincode,
        gstNumber: values.gstNumber || undefined,
        licenseNumber: values.licenseNumber || undefined,
        gstDocUrl: gstDocUrl || undefined,
        licenseDocUrl: licenseDocUrl || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <Modal
        open={open}
        onClose={() => {
          reset();
          onClose();
        }}
        title="Application Submitted"
      >
        <AlertBox tone="success" title="Dealer application submitted">
          It is now awaiting admin approval. This dealer will appear in POS's dealer search once
          approved from Admin → Dealers.
        </AlertBox>
        <div className="mt-4">
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Register New Dealer"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="First name"
            value={values.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            required
          />
          <FormInput
            label="Last name"
            value={values.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            required
          />
          <FormInput
            label="Phone number"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            required
          />
          <FormInput
            label="Store name"
            value={values.storeName}
            onChange={(e) => set("storeName", e.target.value)}
            required
          />
          <FormInput
            label="Store address"
            className="sm:col-span-2"
            value={values.storeAddress}
            onChange={(e) => set("storeAddress", e.target.value)}
            required
          />
          <FormInput
            label="City"
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
            required
          />
          <FormInput
            label="PIN code"
            value={values.pincode}
            onChange={(e) => set("pincode", e.target.value)}
            required
          />
          <FormInput
            label="GST number (optional)"
            value={values.gstNumber}
            onChange={(e) => set("gstNumber", e.target.value.toUpperCase())}
            error={gstError ?? undefined}
            hint="A valid GSTIN automatically fills and locks the state below."
          />
          <FormSelect
            label="State"
            value={values.stateId}
            onChange={(e) => set("stateId", e.target.value)}
            disabled={gstLocked}
            hint={gstLocked ? "Locked from the GST number." : undefined}
            required
          >
            <option value="">— Select a state —</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FormSelect>
          <FormInput
            label="License number (optional)"
            value={values.licenseNumber}
            onChange={(e) => set("licenseNumber", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormFileInput
            label="GST certificate upload (optional)"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={uploadingGst}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file, "gst");
            }}
            hint={uploadingGst ? "Uploading…" : gstDocUrl ? "Uploaded." : undefined}
          />
          <FormFileInput
            label="License copy upload (optional)"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={uploadingLicense}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file, "license");
            }}
            hint={uploadingLicense ? "Uploading…" : licenseDocUrl ? "Uploaded." : undefined}
          />
        </div>

        {error && <AlertBox tone="danger">{error}</AlertBox>}
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={isPending || uploadingGst || uploadingLicense}
          >
            {isPending ? "Submitting…" : "Submit Application"}
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
