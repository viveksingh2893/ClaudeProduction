"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Loader2, UploadCloud } from "lucide-react";
import { AlertBox, Button } from "@kisan4u/ui";
import { PAN_REGEX, IFSC_REGEX, ACCOUNT_NUMBER_REGEX } from "@kisan4u/validators";
import { submitBaForm2Action } from "./actions";

type DocField = "panDocKey" | "chequeDocKey";

const DOC_FIELDS: { field: DocField; label: string }[] = [
  { field: "panDocKey", label: "PAN card copy" },
  { field: "chequeDocKey", label: "Cancelled cheque" },
];

type F2 = {
  panNumber: string;
  bankName: string;
  bankBranch: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  panDocKey: string;
  chequeDocKey: string;
};

const EMPTY: F2 = {
  panNumber: "",
  bankName: "",
  bankBranch: "",
  accountHolderName: "",
  accountNumber: "",
  ifsc: "",
  panDocKey: "",
  chequeDocKey: "",
};

/**
 * Per-field input shaping + a live format check, so a malformed PAN/
 * account number/IFSC is caught before submit instead of only after a
 * server round-trip. The three regexes are shared with the server-side
 * schema (packages/validators/src/ba.ts's baForm2Schema) so client and
 * server can never disagree on what "valid" means.
 */
const TEXT_FIELDS: {
  name: keyof F2;
  label: string;
  /** Transforms every keystroke (e.g. force-uppercase, strip non-digits) before it lands in state. */
  transform?: (raw: string) => string;
  /** Live format check, shown once the field is non-empty. Absent = free text, no format rule. */
  pattern?: RegExp;
  patternHint?: string;
  inputMode?: "text" | "numeric";
}[] = [
  {
    name: "panNumber",
    label: "PAN number",
    transform: (v) => v.toUpperCase(),
    pattern: PAN_REGEX,
    patternHint: "10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)",
  },
  { name: "bankName", label: "Bank name" },
  { name: "bankBranch", label: "Bank branch" },
  { name: "accountHolderName", label: "Account holder name" },
  {
    name: "accountNumber",
    label: "Account number",
    // Bank account numbers are digits only — strip anything else as the
    // seller types, rather than accepting letters and rejecting on submit.
    transform: (v) => v.replace(/\D/g, ""),
    pattern: ACCOUNT_NUMBER_REGEX,
    patternHint: "6–20 digits, numbers only",
    inputMode: "numeric",
  },
  {
    name: "ifsc",
    label: "IFSC code",
    transform: (v) => v.toUpperCase(),
    pattern: IFSC_REGEX,
    patternHint: "11 characters: 4 letters, 0, then 6 letters/digits (e.g. HDFC0001234)",
  },
];

export function Form2Client() {
  const router = useRouter();
  const [form, setForm] = useState<F2>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof F2, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<string | null>(null);
  // File names are only for showing what was picked — the server keeps the URL.
  const [fileNames, setFileNames] = useState<Partial<Record<DocField, string>>>({});

  async function upload(field: DocField, file: File) {
    setUploading(field);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/account/ba/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "Upload failed");
      else {
        setForm((s) => ({ ...s, [field]: json.url }));
        setFileNames((n) => ({ ...n, [field]: file.name }));
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(null);
    }
  }

  const invalidField = TEXT_FIELDS.find((f) => f.pattern && !f.pattern.test(form[f.name]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (invalidField) {
      setTouched((t) => ({ ...t, [invalidField.name]: true }));
      setError(`${invalidField.label}: ${invalidField.patternHint}`);
      return;
    }
    start(async () => {
      const res = await submitBaForm2Action(form);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {TEXT_FIELDS.map((f) => {
        const value = form[f.name];
        const showError = touched[f.name] && !!f.pattern && value.length > 0 && !f.pattern.test(value);
        return (
          <div key={f.name}>
            <label className="mb-1 block text-xs font-semibold text-gray-600">{f.label}</label>
            <input
              required
              value={value}
              inputMode={f.inputMode}
              onChange={(e) => {
                const next = f.transform ? f.transform(e.target.value) : e.target.value;
                setForm((s) => ({ ...s, [f.name]: next }));
              }}
              onBlur={() => setTouched((t) => ({ ...t, [f.name]: true }))}
              className={`w-full rounded-lg border-[1.5px] px-3 py-2 text-sm outline-none focus:border-green-600 ${
                showError ? "border-danger" : "border-border"
              }`}
            />
            {showError ? (
              <span className="mt-1 block text-xs font-medium text-danger">{f.patternHint}</span>
            ) : (
              f.patternHint && <span className="mt-1 block text-xs text-gray-400">{f.patternHint}</span>
            )}
          </div>
        );
      })}

      {DOC_FIELDS.map(({ field, label }) => {
        const isUploading = uploading === field;
        const uploaded = !!form[field];
        return (
          <div key={field}>
            <span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-lg border-[1.5px] border-dashed px-4 py-3 transition-colors ${
                uploaded
                  ? "border-green-600 bg-green-50"
                  : "border-green-500/50 bg-surface hover:border-green-600 hover:bg-green-50/60"
              } ${isUploading ? "pointer-events-none opacity-70" : ""}`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  uploaded ? "bg-green-600 text-white" : "bg-green-100 text-green-700"
                }`}
              >
                {isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : uploaded ? (
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <UploadCloud className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">
                  {isUploading ? "Uploading…" : uploaded ? "Uploaded" : "Choose a file to upload"}
                </span>
                <span className="flex items-center gap-1 truncate text-xs text-gray-500">
                  {uploaded && fileNames[field] ? (
                    <>
                      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{fileNames[field]}</span>
                    </>
                  ) : (
                    "PDF or image, up to 5 MB"
                  )}
                </span>
              </span>
              <span className="shrink-0 rounded-md border-[1.5px] border-green-600 bg-surface px-3 py-1.5 text-xs font-bold text-green-700">
                {uploaded ? "Replace" : "Browse"}
              </span>
              <input
                type="file"
                accept="application/pdf,image/*"
                className="sr-only"
                disabled={isUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(field, file);
                  // Allow picking the same file again after an error.
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        );
      })}

      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <Button type="submit" variant="secondary" disabled={pending} fullWidth>
        {pending ? "Saving…" : "Save bank details"}
      </Button>
    </form>
  );
}
