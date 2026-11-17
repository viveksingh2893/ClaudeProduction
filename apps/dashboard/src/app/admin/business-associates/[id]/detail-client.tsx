"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DocumentViewerButton } from "@/components/document-viewer-button";
import { editBaAction } from "../actions";

type Profile = {
  baId: string;
  status: string;
  firstName: string;
  lastName: string;
  contactNumber: string;
  email: string;
  pincode: string;
  state: string;
  city: string;
  panNumber: string;
  bankName: string;
  bankBranch: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  panDocKey: string;
  chequeDocKey: string;
};

const EDITABLE: { name: keyof Profile; label: string }[] = [
  { name: "firstName", label: "First name" },
  { name: "lastName", label: "Last name" },
  { name: "contactNumber", label: "Contact number" },
  { name: "email", label: "Email" },
  { name: "pincode", label: "Pincode" },
  { name: "state", label: "State" },
  { name: "city", label: "City" },
  { name: "panNumber", label: "PAN" },
  { name: "bankName", label: "Bank name" },
  { name: "bankBranch", label: "Bank branch" },
  { name: "accountHolderName", label: "Account holder" },
  { name: "accountNumber", label: "Account number" },
  { name: "ifsc", label: "IFSC" },
];

export function BaDetailClient({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [form, setForm] = useState<Profile>(profile);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setMsg(res.error ?? "Failed");
      else {
        setMsg("Saved.");
        router.refresh();
      }
    });
  }

  async function uploadDoc(field: "panDocKey" | "chequeDocKey", file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/admin/business-associates/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (json.ok) setForm((s) => ({ ...s, [field]: json.url }));
    else setMsg(json.error ?? "Upload failed");
  }

  return (
    <div className="rounded-lg border border-gray-100 p-5">
      <div className="grid grid-cols-2 gap-2">
        {EDITABLE.map((f) => (
          <label key={f.name} className="text-xs">
            <span className="text-gray-500">{f.label}</span>
            <input
              value={form[f.name]}
              onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {(["panDocKey", "chequeDocKey"] as const).map((field) => (
          <div key={field}>
            <span className="text-gray-500">{field === "panDocKey" ? "PAN copy" : "Cheque"}</span>
            {form[field] && (
              <span className="ml-1">
                <DocumentViewerButton
                  url={`/api/admin/business-associates/${profile.baId}/documents/${field === "panDocKey" ? "pan" : "cheque"}`}
                  label={field === "panDocKey" ? "PAN copy" : "Cancelled cheque"}
                />
              </span>
            )}
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => e.target.files?.[0] && uploadDoc(field, e.target.files[0])}
              className="mt-0.5 block w-full"
            />
          </div>
        ))}
      </div>

      <button
        className="mt-3 rounded bg-green-700 px-4 py-1.5 text-xs font-semibold text-white"
        disabled={pending}
        onClick={() =>
          run(() =>
            editBaAction({
              baId: profile.baId,
              firstName: form.firstName,
              lastName: form.lastName,
              contactNumber: form.contactNumber,
              email: form.email,
              pincode: form.pincode,
              state: form.state,
              city: form.city,
              panNumber: form.panNumber || undefined,
              panDocKey: form.panDocKey || undefined,
              bankName: form.bankName || undefined,
              bankBranch: form.bankBranch || undefined,
              accountHolderName: form.accountHolderName || undefined,
              accountNumber: form.accountNumber || undefined,
              ifsc: form.ifsc || undefined,
              chequeDocKey: form.chequeDocKey || undefined,
            }),
          )
        }
      >
        Save details
      </button>

      {msg && <p className="mt-2 text-xs text-gray-600">{msg}</p>}
    </div>
  );
}
