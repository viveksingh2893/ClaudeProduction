"use client";

import { useRef, useState } from "react";
import { AlertBox } from "@kisan4u/ui";
import { FileText, Upload, X } from "lucide-react";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.webp";

/**
 * Spec §2 — the licence document picker used in both the seller's and the
 * admin's "Add new licence" forms: shows the chosen filename with
 * replace/remove controls (not a bare native file input), validates
 * type/size client-side before the file ever reaches the server action,
 * and surfaces format/size hints up front. The server still re-validates
 * type/size independently — this is a UX layer, not the authoritative check.
 */
export function LicenceDocumentInput({
  file,
  onChange,
  error,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleFiles(fileList: FileList | null) {
    const picked = fileList?.[0] ?? null;
    if (!picked) return;
    if (!ACCEPTED_TYPES.includes(picked.type)) {
      setLocalError("Unsupported file type — upload a PDF, JPEG, PNG, or WEBP.");
      onChange(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (picked.size > MAX_SIZE_BYTES) {
      setLocalError("File is too large — the maximum size is 5MB.");
      onChange(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setLocalError(null);
    onChange(picked);
  }

  function remove() {
    onChange(null);
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const shownError = localError ?? error ?? null;

  return (
    <div>
      <label className="mb-1 block text-[13px] font-semibold text-ink">
        Licence document <span className="text-danger">*</span>
      </label>
      <p className="mb-1.5 text-[12px] text-gray-500">PDF, JPEG, PNG, or WEBP — max 5MB.</p>
      {!file ? (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-border px-3 py-2.5 text-[13px] text-gray-600 hover:border-green-600 hover:bg-bg-dashboard">
          <Upload className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          Choose a file…
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-lg border-[1.5px] border-border bg-bg-dashboard px-3 py-2 text-[13px]">
          <span className="flex min-w-0 items-center gap-1.5">
            <FileText className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
            <span className="truncate text-ink">{file.name}</span>
            <span className="shrink-0 text-gray-500">
              ({(file.size / (1024 * 1024)).toFixed(2)} MB)
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <label className="cursor-pointer font-semibold text-green-700 hover:underline">
              Replace
              <input
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                className="sr-only"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>
            <button
              type="button"
              onClick={remove}
              aria-label="Remove selected document"
              className="text-gray-500 hover:text-danger"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      {shownError && <AlertBox tone="danger">{shownError}</AlertBox>}
    </div>
  );
}
