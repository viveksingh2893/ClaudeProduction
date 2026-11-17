"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Store,
  Truck,
  UploadCloud,
  X,
} from "lucide-react";
import { AlertBox, Button, FormInput, FormSelect } from "@kisan4u/ui";
import { stateNameFromGstNumber, GSTIN_REGEX } from "@kisan4u/validators";
import { submitDealerApplicationAction } from "./apply-actions";

export type DealerApplicationPrefill = {
  name: string;
  storeName: string;
  storeAddress: string;
  city: string;
  stateId: string;
  pincode: string;
  gstNumber: string;
  licenseNumber: string;
  gstDocUrl: string;
  licenseDocUrl: string;
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type DocSlot = { name: string; url: string } | null;

async function uploadDoc(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/register/dealer/upload-doc", { method: "POST", body });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
  if (!res.ok || !data?.ok || !data.url) return { ok: false, error: data?.error ?? "Upload failed." };
  return { ok: true, url: data.url };
}

const PERKS = [
  { icon: BadgeCheck, label: "Bulk & wholesale pricing" },
  { icon: Store, label: "Dedicated dealer catalogue" },
  { icon: Truck, label: "Reliable bulk logistics" },
];

/**
 * "Become a Dealer" for a signed-in customer — same business fields as the
 * signed-out registration form, no phone step (already verified), plus
 * optional GST / licence document upload. A PENDING / REJECTED application
 * opens here prefilled for edit + resubmit; the account keeps its CUSTOMER
 * role until an admin approves.
 */
export function LoggedInApplicationForm({
  states,
  prefill,
  status,
  rejectionReason,
}: {
  states: Array<{ id: string; name: string }>;
  prefill: DealerApplicationPrefill;
  status: "none" | "pending" | "rejected";
  rejectionReason: string | null;
}) {
  const [name, setName] = useState(prefill.name);
  const [storeName, setStoreName] = useState(prefill.storeName);
  const [storeAddress, setStoreAddress] = useState(prefill.storeAddress);
  const [city, setCity] = useState(prefill.city);
  const [stateId, setStateId] = useState(prefill.stateId);
  const [pincode, setPincode] = useState(prefill.pincode);
  const [gstNumber, setGstNumber] = useState(prefill.gstNumber);
  const [licenseNumber, setLicenseNumber] = useState(prefill.licenseNumber);
  const [gstDoc, setGstDoc] = useState<DocSlot>(
    prefill.gstDocUrl ? { name: "GST document on file", url: prefill.gstDocUrl } : null,
  );
  const [licenseDoc, setLicenseDoc] = useState<DocSlot>(
    prefill.licenseDocUrl ? { name: "Licence document on file", url: prefill.licenseDocUrl } : null,
  );
  const [uploading, setUploading] = useState<null | "gst" | "license">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { resubmitted: boolean }>(null);
  const [isPending, startTransition] = useTransition();

  const [gstDetectedStateName, setGstDetectedStateName] = useState<string | null>(null);
  const [gstInvalid, setGstInvalid] = useState(false);
  const gstLocked = gstDetectedStateName !== null;

  function handleGstChange(raw: string) {
    const value = raw.toUpperCase();
    setGstNumber(value);
    if (!value || value.length < 15) {
      setGstDetectedStateName(null);
      setGstInvalid(false);
      return;
    }
    const derivedName = stateNameFromGstNumber(value);
    const match = derivedName
      ? states.find((s) => s.name.toLowerCase() === derivedName.toLowerCase())
      : undefined;
    if (!match) {
      setGstDetectedStateName(null);
      setGstInvalid(true);
      return;
    }
    setGstInvalid(false);
    setGstDetectedStateName(match.name);
    setStateId(match.id);
  }

  async function onPickFile(slot: "gst" | "license", file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`${slot === "gst" ? "GST" : "Licence"} document must be under 5 MB.`);
      return;
    }
    setUploading(slot);
    const res = await uploadDoc(file);
    setUploading(null);
    if (!res.ok) {
      setError(`${slot === "gst" ? "GST" : "Licence"} document: ${res.error}`);
      return;
    }
    const value = { name: file.name, url: res.url };
    if (slot === "gst") setGstDoc(value);
    else setLicenseDoc(value);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (gstNumber.trim() && !GSTIN_REGEX.test(gstNumber.trim().toUpperCase())) {
      setError("Enter a valid 15-character GST number, or leave it blank.");
      return;
    }
    if (licenseNumber.trim().length < 3) {
      setError("Enter your licence number.");
      return;
    }
    if (!licenseDoc?.url) {
      setError("Upload a copy of your licence.");
      return;
    }

    startTransition(async () => {
      const result = await submitDealerApplicationAction({
        name,
        storeName,
        storeAddress,
        city,
        stateId,
        pincode,
        gstNumber,
        licenseNumber,
        gstDocUrl: gstDoc?.url ?? "",
        licenseDocUrl: licenseDoc?.url ?? "",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({ resubmitted: result.resubmitted });
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-extrabold text-green-800">
          {done.resubmitted ? "Application updated" : "Application submitted"}
        </h2>
        <p className="mx-auto mt-2 max-w-[420px] text-sm leading-relaxed text-gray-600">
          Our team will review it shortly. Keep using your customer account meanwhile — you&apos;ll
          be switched to a dealer account automatically once it&apos;s approved.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-bold text-green-700 hover:underline"
        >
          Back to shopping →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-green-800 to-green-600 p-6 text-white sm:p-7">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-extrabold sm:text-2xl">Become a Dealer</h1>
        <p className="mt-1 max-w-[460px] text-sm leading-relaxed text-white/90">
          Add your business details to apply. Your customer account stays active while we review
          this — you&apos;ll switch to a dealer account once it&apos;s approved.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
          {PERKS.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/90">
              <p.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {p.label}
            </span>
          ))}
        </div>
      </div>

      {status === "pending" && (
        <AlertBox tone="info">
          Your application is under review. You can edit the details below and resubmit any time
          before it&apos;s approved.
        </AlertBox>
      )}
      {status === "rejected" && (
        <AlertBox tone="danger">
          {rejectionReason
            ? `Your application needs changes: ${rejectionReason}`
            : "Your application needs changes. Please review your details and resubmit."}
        </AlertBox>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Business details */}
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-500">
            Business details
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormInput label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
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
            <FormInput
              label="Pincode"
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              required
            />
            <FormSelect
              label="State"
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              required
              disabled={gstLocked}
              hint={gstLocked ? `Locked to ${gstDetectedStateName} from your GST number` : undefined}
              className="sm:col-span-2"
            >
              <option value="">— Select your state —</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </FormSelect>
            <FormInput
              label="GST number (optional)"
              value={gstNumber}
              onChange={(e) => handleGstChange(e.target.value)}
              maxLength={15}
              error={gstInvalid ? "Enter a valid 15-character GST number" : undefined}
              hint={!gstInvalid && !gstLocked ? "Auto-fills and locks your state" : undefined}
            />
            <FormInput
              label="Licence number"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              required
            />
          </div>
        </section>

        {/* Documents */}
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">KYC documents</h2>
          <p className="mt-1 mb-4 text-xs text-gray-500">
            Your GST certificate (optional) and dealer licence copy (required). PDF or photo, up to 5
            MB each.
          </p>
          <div className="flex flex-col gap-3">
            <DocRow
              title="GST certificate"
              doc={gstDoc}
              busy={uploading === "gst"}
              onPick={(f) => void onPickFile("gst", f)}
              onClear={() => setGstDoc(null)}
            />
            <DocRow
              title="Dealer licence"
              doc={licenseDoc}
              busy={uploading === "license"}
              onPick={(f) => void onPickFile("license", f)}
              onClear={() => setLicenseDoc(null)}
            />
          </div>
        </section>

        {error && <AlertBox tone="danger">{error}</AlertBox>}

        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" disabled={isPending || uploading !== null} fullWidth>
            {isPending
              ? "Submitting…"
              : status === "none"
                ? "Submit application"
                : "Resubmit application"}
          </Button>
          <p className="text-center text-xs text-gray-500">
            A Kisan4U team member reviews every application. You&apos;ll be notified once it&apos;s
            approved.
          </p>
        </div>
      </form>
    </div>
  );
}

function DocRow({
  title,
  doc,
  busy,
  onPick,
  onClear,
}: {
  title: string;
  doc: DocSlot;
  busy: boolean;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-700">
        {doc ? <FileText className="h-4.5 w-4.5" aria-hidden="true" /> : <UploadCloud className="h-4.5 w-4.5" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="truncate text-xs text-gray-500">
          {busy ? "Uploading…" : doc ? doc.name : "PDF or image, up to 5 MB"}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-green-700" aria-hidden="true" />
      ) : doc ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full p-1 text-gray-400 hover:text-gray-600"
          aria-label={`Remove ${title}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-full border-[1.5px] border-green-700 px-3 py-1 text-xs font-bold text-green-700 hover:bg-green-50"
        >
          Upload
        </button>
      )}
    </div>
  );
}
