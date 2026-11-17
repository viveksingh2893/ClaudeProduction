"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Upload, X } from "lucide-react";
import { AlertBox, Button } from "@kisan4u/ui";
import { DocumentViewerButton } from "@/components/document-viewer-button";
import { DealerFormButton, type DealerFormValues } from "../dealer-form-modal";
import {
  proposeDealerProfileChangesAction,
  approveDealerProfileChangesAction,
  discardDealerProfileChangesAction,
} from "../actions";

/** Everything proposeDealerProfileChangesAction needs, minus profileId — the full form is always resubmitted so a single-field edit (e.g. a re-uploaded doc) still validates. */
export type DealerProfileCurrent = DealerFormValues & {
  gstDocUrl: string;
  licenseDocUrl: string;
};

/** "Edit dealer details" — opens the shared dealer form. For an APPROVED dealer the change is parked and needs the Approve step below; for a pending/rejected application it applies straight away. */
export function EditDealerDetailsButton({
  profileId,
  states,
  current,
  isApproved,
}: {
  profileId: string;
  states: { id: string; name: string }[];
  current: DealerProfileCurrent;
  isApproved: boolean;
}) {
  return (
    <DealerFormButton
      trigger={{ label: "Edit business details", icon: "edit" }}
      title="Edit dealer business details"
      submitLabel={isApproved ? "Submit for approval" : "Save changes"}
      states={states}
      initial={current}
      confirmHint={
        isApproved
          ? "This dealer is already approved — your changes are saved as pending and only go live after you approve them below."
          : undefined
      }
      onSubmit={(values) =>
        proposeDealerProfileChangesAction({
          profileId,
          ...values,
          gstDocUrl: current.gstDocUrl,
          licenseDocUrl: current.licenseDocUrl,
        })
      }
    />
  );
}

type PendingChanges = Record<string, unknown> & {
  proposedAt?: string;
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  storeName: "Store name",
  storeAddress: "Store address",
  city: "City",
  state: "State",
  stateId: "State ID",
  pincode: "Pincode",
  gstNumber: "GST number",
  licenseNumber: "License number",
  gstDocUrl: "GST document",
  licenseDocUrl: "License document",
};

/** Shows the parked pendingChanges and the Approve / Discard controls. Rendered only when DealerProfile.pendingChanges is set. */
export function PendingChangesPanel({
  profileId,
  pendingChanges,
}: {
  profileId: string;
  pendingChanges: PendingChanges;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "approve" | "discard">(null);
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(pendingChanges).filter(
    ([key]) => !["proposedByUserId", "proposedAt"].includes(key),
  );

  function run(kind: "approve" | "discard") {
    setError(null);
    setBusy(kind);
    const action =
      kind === "approve"
        ? approveDealerProfileChangesAction(profileId)
        : discardDealerProfileChangesAction(profileId);
    action
      .then((result) => {
        setBusy(null);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      })
      .catch(() => {
        setBusy(null);
        setError("Something went wrong — try again.");
      });
  }

  return (
    <div className="rounded-lg border border-earth-300 bg-earth-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-earth-800">Changes awaiting approval</span>
        {pendingChanges.proposedAt && (
          <span className="text-xs text-earth-700">
            proposed {new Date(pendingChanges.proposedAt).toLocaleString("en-IN")}
          </span>
        )}
      </div>
      <dl className="mb-3 divide-y divide-earth-200 text-sm">
        {entries.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4 py-1.5">
            <dt className="text-earth-700">{FIELD_LABELS[key] ?? key}</dt>
            <dd className="text-right font-medium text-earth-900">
              {value ? String(value) : "—"}
            </dd>
          </div>
        ))}
      </dl>
      {error && (
        <div className="mb-2">
          <AlertBox tone="danger">{error}</AlertBox>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          loading={busy === "approve"}
          disabled={busy !== null}
          onClick={() => run("approve")}
        >
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Approve changes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={busy === "discard"}
          disabled={busy !== null}
          onClick={() => run("discard")}
        >
          <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Discard
        </Button>
      </div>
    </div>
  );
}

/** View + re-upload for one KYC document. The re-uploaded URL is pushed through the same propose/approve gate as any other edit. */
export function DealerDocumentManager({
  profileId,
  which,
  label,
  currentUrl,
  resolvedUrl,
  current,
  isApproved,
}: {
  profileId: string;
  which: "gstDocUrl" | "licenseDocUrl";
  label: string;
  currentUrl: string;
  resolvedUrl: string | null;
  current: DealerProfileCurrent;
  isApproved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/admin/dealer-documents", { method: "POST", body });
      const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok || !data.url) {
        setError(data.error ?? "Upload failed.");
        setBusy(false);
        return;
      }
      const result = await proposeDealerProfileChangesAction({
        profileId,
        name: current.name,
        storeName: current.storeName,
        storeAddress: current.storeAddress,
        city: current.city,
        stateId: current.stateId,
        pincode: current.pincode,
        gstNumber: current.gstNumber,
        licenseNumber: current.licenseNumber,
        gstDocUrl: which === "gstDocUrl" ? data.url : current.gstDocUrl,
        licenseDocUrl: which === "licenseDocUrl" ? data.url : current.licenseDocUrl,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote(result.pending ? "Uploaded — awaiting approval below." : "Uploaded and saved.");
      router.refresh();
    } catch {
      setBusy(false);
      setError("Upload failed — try again.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DocumentViewerButton url={resolvedUrl} label={label} />
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        {busy ? "Uploading…" : currentUrl ? "Replace" : "Upload"}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={busy}
          onChange={handleFile}
        />
      </label>
      {isApproved && (
        <span className="text-xs text-gray-500">changes need approval</span>
      )}
      {note && <span className="text-xs text-green-700">{note}</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
