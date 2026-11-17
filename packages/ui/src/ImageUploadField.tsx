"use client";

import { useRef, useState } from "react";
import { AlertBox } from "./Feedback";
import { ProductImage } from "./ProductImage";
import { Loader2, Upload, X } from "lucide-react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_EXTENSIONS = ".jpg,.jpeg,.png,.webp";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export type ImageUploadResult = { ok: true; url: string } | { ok: false; error: string };

function isValidImageUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The shared image-source picker for every catalog entity form (category,
 * subcategory, sub-subcategory, brand, manufacturer, product, variant) —
 * spec: "Use a clear source selector: Upload image / Use image URL. The
 * user should choose one source for each image entry." Entity-agnostic by
 * design: the caller supplies `onUpload`, which wraps whatever server
 * action actually persists the file for that specific entity type/id
 * (different folder path per entity — see
 * packages/providers/src/storage.ts's catalogImagePaths) — this component
 * only owns the upload/URL UI, never the storage decision itself.
 *
 * `onUploadingChange` lets the parent form disable its Save button while
 * an upload is in flight, per spec "Do not submit the complete form
 * twice" — the upload is never tied to the form's own submit handler, so
 * a stale/empty value can't be saved mid-upload.
 */
export function ImageUploadField({
  label,
  value,
  onChange,
  onUpload,
  required,
  hint,
  onUploadingChange,
  resolveDisplaySrc,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  onUpload: (file: File) => Promise<ImageUploadResult>;
  required?: boolean;
  hint?: string;
  onUploadingChange?: (uploading: boolean) => void;
  /**
   * `value` itself is never touched by this — it stays whatever the
   * caller's own state/form field holds (a bare storage-relative path for
   * an uploaded file), so mode-detection and the round-trip back through
   * `onChange` are unaffected. This only transforms what's handed to the
   * `<img>` preview, for a caller (e.g. a separate-origin admin app) that
   * needs an absolute url to actually load it. Defaults to identity —
   * every existing caller keeps rendering `value` verbatim.
   */
  resolveDisplaySrc?: (url: string) => string;
}) {
  const displaySrc = (url: string) => (resolveDisplaySrc ? resolveDisplaySrc(url) : url);
  const [mode, setMode] = useState<"upload" | "url">(
    value && !value.startsWith("/api/uploads/") ? "url" : "upload",
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function setUploadingState(next: boolean) {
    setUploading(next);
    onUploadingChange?.(next);
  }

  async function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Unsupported file type — upload a JPEG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("File is too large — the maximum size is 5MB.");
      return;
    }
    setFileName(file.name);
    setUploadingState(true);
    try {
      const result = await onUpload(file);
      if (!result.ok) {
        setError(result.error);
        setFileName(null);
        return;
      }
      onChange(result.url);
    } catch {
      setError("Upload failed — try again.");
      setFileName(null);
    } finally {
      setUploadingState(false);
    }
  }

  function removeImage() {
    onChange("");
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <label className="mb-1 block text-[13px] font-semibold text-ink">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {hint && <p className="mb-1.5 text-[12px] text-gray-500">{hint}</p>}

      <div className="mb-2 inline-flex rounded-lg border border-border p-0.5 text-[12px]">
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            mode === "upload" ? "bg-green-600 text-white" : "text-gray-600 hover:bg-bg-dashboard"
          }`}
        >
          Upload image
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            mode === "url" ? "bg-green-600 text-white" : "text-gray-600 hover:bg-bg-dashboard"
          }`}
        >
          Use image URL
        </button>
      </div>

      {mode === "upload" ? (
        <>
          {value && !uploading ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border-[1.5px] border-border bg-bg-dashboard px-3 py-2 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-green-50">
                  <ProductImage src={displaySrc(value)} alt={fileName ?? label} />
                </span>
                <span className="truncate text-ink">{fileName ?? "Current image"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <label className="cursor-pointer font-semibold text-green-700 hover:underline">
                  Replace
                  <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPTED_EXTENSIONS}
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={removeImage}
                  aria-label="Remove image"
                  className="text-gray-500 hover:text-danger"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </span>
            </div>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
              className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-[1.5px] border-dashed px-3 py-5 text-center text-[13px] transition-colors ${
                dragOver
                  ? "border-green-600 bg-green-50"
                  : "border-border text-gray-600 hover:border-green-600 hover:bg-bg-dashboard"
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-green-700" aria-hidden="true" />
                  <span>Uploading {fileName}…</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  <span>Drag and drop, or click to choose a file</span>
                  <span className="text-[11px] text-gray-500">JPEG, PNG, or WEBP — max 5MB</span>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </label>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full rounded-md border-[1.5px] border-border px-3 py-2 text-sm outline-none focus:border-green-600"
          />
          {value && !isValidImageUrl(value) && (
            <p className="text-[12px] text-danger">Enter a valid http:// or https:// URL.</p>
          )}
          {value && isValidImageUrl(value) && (
            <div className="h-16 w-16 overflow-hidden rounded-md bg-green-50">
              <ProductImage src={displaySrc(value)} alt={label} fallbackLabel="Couldn't load this URL" />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-2">
          <AlertBox tone="danger">{error}</AlertBox>
        </div>
      )}
    </div>
  );
}
