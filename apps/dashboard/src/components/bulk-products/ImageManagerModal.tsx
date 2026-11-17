"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Trash2, Upload } from "lucide-react";
import { Button, AlertBox } from "@kisan4u/ui";
import { ModalShell } from "./cell-primitives";
import type { BulkGroupState } from "./types";

type ImageRow = NonNullable<BulkGroupState["shared"]["images"]>[number];
type UploadResult = { ok: true; urls: { url: string } } | { ok: false; error: string };

/**
 * "Main Image" (single) + "Additional Images" (gallery, reorderable) in
 * one modal — spec: "Clicking Additional Images should open a small
 * media/gallery manager." Every image (device upload or URL) goes through
 * the same processAndUploadCatalogImage(FromUrl) pipeline the caller's
 * onUploadImage(FromUrl) props wrap, so nothing here ever stores a raw
 * upstream URL — only the platform-owned processed one that comes back.
 */
export function ImageManagerModal({
  group,
  onUploadImage,
  onUploadImageFromUrl,
  onSave,
  onClose,
}: {
  group: BulkGroupState;
  onUploadImage: (file: File) => Promise<UploadResult>;
  onUploadImageFromUrl: (url: string) => Promise<UploadResult>;
  onSave: (primaryImageUrl: string, images: ImageRow[]) => void;
  onClose: () => void;
}) {
  const [primaryImageUrl, setPrimaryImageUrl] = useState(group.shared.primaryImageUrl ?? "");
  const [images, setImages] = useState<ImageRow[]>(group.shared.images ?? []);
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePrimaryUpload(file: File) {
    setUploading(true);
    setError(null);
    const result = await onUploadImage(file);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPrimaryImageUrl(result.urls.url);
  }

  async function handleAddFromFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    const newImages: ImageRow[] = [];
    for (const file of Array.from(files)) {
      const result = await onUploadImage(file);
      if (!result.ok) {
        setError(`${file.name}: ${result.error}`);
        continue;
      }
      newImages.push({ url: result.urls.url, altText: "", position: images.length + newImages.length, isActive: true });
    }
    setImages((prev) => [...prev, ...newImages]);
    setUploading(false);
  }

  async function handleAddFromUrl() {
    if (!urlInput.trim()) return;
    setUploading(true);
    setError(null);
    const result = await onUploadImageFromUrl(urlInput.trim());
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setImages((prev) => [...prev, { url: result.urls.url, altText: "", position: prev.length, isActive: true }]);
    setUrlInput("");
  }

  function move(index: number, dir: -1 | 1) {
    setImages((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((img, i) => ({ ...img, position: i }));
    });
  }
  function remove(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index).map((img, i) => ({ ...img, position: i })));
  }

  return (
    <ModalShell title="Product images" onClose={onClose} wide>
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <div className="flex flex-col gap-4">
        <div>
          <h4 className="mb-2 text-sm font-bold text-ink">Main image</h4>
          <div className="flex items-center gap-4">
            {primaryImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={primaryImageUrl} alt="Main" className="h-24 w-24 rounded-md border border-border object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-gray-400">
                No image
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border-[1.5px] border-border px-3.5 py-2 text-sm font-semibold text-ink hover:bg-bg-dashboard">
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void handlePrimaryUpload(e.target.files[0])}
              />
            </label>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-bold text-ink">Additional images</h4>
          <div className="flex flex-wrap gap-2.5">
            {images.map((img, i) => (
              <div key={`${img.url}-${i}`} className="relative flex flex-col items-center gap-1 rounded-md border border-border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.altText || ""} className="h-20 w-20 rounded object-cover" />
                <div className="flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} className="rounded p-1 text-gray-400 hover:text-ink">
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="rounded p-1 text-gray-400 hover:text-ink">
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => remove(i)} className="rounded p-1 text-gray-400 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
            {uploading && (
              <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border-[1.5px] border-border px-3.5 py-2 text-sm font-semibold text-ink hover:bg-bg-dashboard">
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload images
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleAddFromFiles(e.target.files)}
              />
            </label>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste image URL…"
              className="w-64 rounded-md border-[1.5px] border-border px-3 py-2 text-sm outline-none focus:border-green-600"
            />
            <Button type="button" size="sm" variant="outline" onClick={() => void handleAddFromUrl()}>
              Add from URL
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={() => onSave(primaryImageUrl, images)}>
          Save
        </Button>
      </div>
    </ModalShell>
  );
}
