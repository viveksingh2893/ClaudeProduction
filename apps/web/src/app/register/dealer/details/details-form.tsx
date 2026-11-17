"use client";

import { useState, useTransition } from "react";
import { AlertBox, Button, Card, FormFileInput, FormInput, FormSelect } from "@kisan4u/ui";
import { stateNameFromGstNumber } from "@kisan4u/validators";
import { submitDealerRegistrationAction } from "./actions";

/** Mirrors the limits enforced server-side in the upload route — checked here too so a bad file is rejected before spending a network round trip. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function uploadDealerDocument(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const body = new FormData();
  body.set("file", file);
  // Deliberately /register/dealer/upload-document, not /api/... — the
  // onboarding cookie this endpoint needs is scoped to path
  // "/register/dealer" (see ../verify/actions.ts), so the request has to
  // stay under that same path prefix for the browser to attach it.
  const res = await fetch("/register/dealer/upload-document", { method: "POST", body });
  const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
  if (!res.ok || !data.ok || !data.url) {
    return { ok: false, error: data.error ?? "Upload failed. Please try again." };
  }
  return { ok: true, url: data.url };
}

export function DetailsForm({
  phone,
  states,
}: {
  phone: string;
  states: Array<{ id: string; name: string }>;
}) {
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateId, setStateId] = useState("");
  const [pincode, setPincode] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [gstDocFile, setGstDocFile] = useState<File | null>(null);
  const [licenseDocFile, setLicenseDocFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(setFile: (f: File | null) => void, label: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      if (file && file.size > MAX_UPLOAD_BYTES) {
        setError(`${label} must be under 5 MB.`);
        e.target.value = "";
        setFile(null);
        return;
      }
      setError(null);
      setFile(file);
    };
  }

  // A complete, valid GST number pins the state (its first 2 digits ARE
  // the state) — the dropdown locks to the matching state and free
  // selection is blocked. Clearing the GST number (or leaving it
  // incomplete) hands state selection back to the dealer. The server
  // re-derives the same state from the GST number independently (see
  // packages/auth/src/registration.ts) and never trusts this client pick
  // when a GST number is present, so this lock is a UX aid, not the
  // actual security boundary.
  const [gstDetectedStateName, setGstDetectedStateName] = useState<string | null>(null);
  const [gstInvalid, setGstInvalid] = useState(false);
  const gstLocked = gstDetectedStateName !== null;

  function handleGstChange(raw: string) {
    const value = raw.toUpperCase();
    setGstNumber(value);
    if (!value) {
      setGstDetectedStateName(null);
      setGstInvalid(false);
      return;
    }
    if (value.length < 15) {
      // Still typing — don't flag as invalid yet, don't lock yet.
      setGstDetectedStateName(null);
      setGstInvalid(false);
      return;
    }
    const derivedName = stateNameFromGstNumber(value);
    if (!derivedName) {
      setGstDetectedStateName(null);
      setGstInvalid(true);
      return;
    }
    const match = states.find((s) => s.name.toLowerCase() === derivedName.toLowerCase());
    if (!match) {
      setGstDetectedStateName(null);
      setGstInvalid(true);
      return;
    }
    setGstInvalid(false);
    setGstDetectedStateName(match.name);
    setStateId(match.id);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (gstNumber.trim() && (gstInvalid || gstNumber.trim().length !== 15)) {
      setError("Enter a valid 15-character GST number, or leave it blank.");
      return;
    }
    if (licenseNumber.trim().length < 3) {
      setError("Enter your licence number.");
      return;
    }
    if (!licenseDocFile) {
      setError("Upload a copy of your licence.");
      return;
    }

    startTransition(async () => {
      // Documents upload first (if provided) so the registration submit
      // below carries their final /uploads/... URLs — both are optional,
      // so an unset file just skips straight to an empty string.
      let gstDocUrl = "";
      if (gstDocFile) {
        const uploaded = await uploadDealerDocument(gstDocFile);
        if (!uploaded.ok) {
          setError(`GST document: ${uploaded.error}`);
          return;
        }
        gstDocUrl = uploaded.url;
      }
      let licenseDocUrl = "";
      if (licenseDocFile) {
        const uploaded = await uploadDealerDocument(licenseDocFile);
        if (!uploaded.ok) {
          setError(`License document: ${uploaded.error}`);
          return;
        }
        licenseDocUrl = uploaded.url;
      }

      // On success this action redirects to /dealer/status itself (see
      // ./actions.ts) — Next.js's redirect() propagates straight to
      // client-side navigation, so this call only ever "returns" here on
      // the error path.
      const result = await submitDealerRegistrationAction({
        name,
        storeName,
        storeAddress,
        city,
        stateId,
        pincode,
        gstNumber,
        licenseNumber,
        gstDocUrl,
        licenseDocUrl,
      });
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <Card className="p-5 sm:p-7">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Read-only: this value came from the server-verified onboarding
            session, not from any editable input — there's nothing here for
            a modified browser request to override. */}
        <FormInput
          label="Verified phone number"
          type="tel"
          value={phone}
          readOnly
          disabled
          className="sm:col-span-2"
        />
        <FormInput
          label="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <FormInput
          label="Store name"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          required
        />
        <FormInput
          label="Store address"
          value={storeAddress}
          onChange={(e) => setStoreAddress(e.target.value)}
          required
          className="sm:col-span-2"
        />
        <FormInput label="City" value={city} onChange={(e) => setCity(e.target.value)} required />
        <FormSelect
          label="State"
          value={stateId}
          onChange={(e) => setStateId(e.target.value)}
          required
          disabled={gstLocked}
          hint={gstLocked ? `Locked to ${gstDetectedStateName} from your GST number` : undefined}
        >
          <option value="">— Select your state —</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Pincode"
          value={pincode}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          maxLength={6}
          required
        />
        <FormInput
          label="GST number (optional)"
          value={gstNumber}
          onChange={(e) => handleGstChange(e.target.value)}
          maxLength={15}
          error={gstInvalid ? "Enter a valid 15-character GST number" : undefined}
          hint={
            !gstInvalid && !gstLocked
              ? "Enter your GST number to auto-fill and lock your state"
              : undefined
          }
        />
        <FormInput
          label="Licence number"
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
          required
          className="sm:col-span-2"
        />
        <FormFileInput
          label="GST copy (optional)"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={handleFileChange(setGstDocFile, "GST document")}
          hint="PDF, JPG, PNG, or WEBP — up to 5 MB"
        />
        <FormFileInput
          label="Licence copy"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={handleFileChange(setLicenseDocFile, "Licence document")}
          hint={licenseDocFile ? `Selected: ${licenseDocFile.name}` : "Required — PDF, JPG, PNG or WEBP, up to 5 MB"}
        />

        {error && (
          <div className="sm:col-span-2">
            <AlertBox tone="danger">{error}</AlertBox>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={isPending} fullWidth>
            {isPending ? "Submitting…" : "Submit Application"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
