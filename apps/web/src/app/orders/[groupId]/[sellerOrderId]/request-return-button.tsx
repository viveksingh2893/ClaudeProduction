"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { AlertBox, Button, FormInput, FormSelect, FormTextarea } from "@kisan4u/ui";
import { requestReturnAction, uploadReturnMediaAction } from "./actions";

type RefundMethod = "WALLET" | "ORIGINAL_SOURCE" | "BANK_TRANSFER";

const MAX_IMAGES = 6;

/**
 * Per-item return request — WALLET is always offered; ORIGINAL_SOURCE only
 * for a prepaid order (nothing to refund electronically for a COD order);
 * BANK_TRANSFER only for COD, since that's the only case with no
 * electronic source to refund to instead. See packages/orders/src/refunds.ts's
 * validateRefundMethodForOrder, the actual authority this mirrors.
 *
 * At least one photo is mandatory, one video is optional — both uploaded
 * immediately on selection (same "choose = upload" pattern as the POS
 * payment-proof screenshot widget), never held as raw File objects across
 * the eventual form submit.
 */
export function RequestReturnButton({
  sellerOrderId,
  orderItemId,
  paymentMethod,
}: {
  sellerOrderId: string;
  orderItemId: string;
  paymentMethod: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const isCod = paymentMethod === "COD";
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(isCod ? "BANK_TRANSFER" : "WALLET");
  const [bankAccountHolderName, setBankAccountHolderName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [isUploadingImage, startUploadingImage] = useTransition();
  const [isUploadingVideo, startUploadingVideo] = useTransition();
  const [mediaError, setMediaError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  if (!showForm) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(true)}>
        Request return
      </Button>
    );
  }

  function handleImageFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (files.length === 0) return;
    setMediaError(null);
    const room = MAX_IMAGES - imageUrls.length;
    if (room <= 0) {
      setMediaError(`You can attach up to ${MAX_IMAGES} photos.`);
      return;
    }
    const toUpload = files.slice(0, room);
    startUploadingImage(async () => {
      for (const file of toUpload) {
        const formData = new FormData();
        formData.set("file", file);
        const result = await uploadReturnMediaAction(sellerOrderId, orderItemId, "image", formData);
        if (!result.ok) {
          setMediaError(result.error);
          continue;
        }
        setImageUrls((prev) => [...prev, result.url]);
      }
    });
  }

  function removeImage(url: string) {
    setImageUrls((prev) => prev.filter((u) => u !== url));
  }

  function handleVideoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (videoInputRef.current) videoInputRef.current.value = "";
    if (!file) return;
    setMediaError(null);
    startUploadingVideo(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadReturnMediaAction(sellerOrderId, orderItemId, "video", formData);
      if (!result.ok) {
        setMediaError(result.error);
        return;
      }
      setVideoUrl(result.url);
      setVideoFileName(file.name);
    });
  }

  function removeVideo() {
    setVideoUrl(null);
    setVideoFileName(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (imageUrls.length === 0) {
      setError("Upload at least one photo of the item.");
      return;
    }
    startTransition(async () => {
      const result = await requestReturnAction({
        sellerOrderId,
        orderItemId,
        reason,
        refundMethod,
        imageUrls,
        videoUrl: videoUrl ?? undefined,
        ...(refundMethod === "BANK_TRANSFER"
          ? { bankAccountHolderName, bankAccountNumber, bankIfsc }
          : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setShowForm(false);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-surface-alt/40 p-4"
    >
      <FormTextarea
        label="Reason for return"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={3}
        rows={3}
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold text-ink">
          Photos of the item <span className="text-danger">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {imageUrls.map((url) => (
            <div key={url} className="relative h-16 w-16 overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded return-evidence photo, not a Next/Image-optimizable static asset */}
              <img src={url} alt="Return evidence" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(url)}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                aria-label="Remove photo"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
          {imageUrls.length < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isUploadingImage}
              className="flex h-16 w-16 flex-col items-center justify-center rounded-md border border-dashed border-border text-xs text-gray-500 hover:border-green-600 hover:text-green-700 disabled:opacity-50"
            >
              {isUploadingImage ? "…" : "+ Add"}
            </button>
          )}
        </div>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleImageFilesChange}
          disabled={isUploadingImage}
          className="hidden"
        />
        <p className="text-xs text-gray-500">
          At least one photo is required — up to {MAX_IMAGES}. JPEG, PNG, or WEBP, max 5MB each.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold text-ink">Video (optional)</label>
        {videoUrl ? (
          <div className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
            <span className="flex-1 truncate text-gray-700">{videoFileName ?? "Video attached"}</span>
            <button
              type="button"
              onClick={removeVideo}
              className="rounded-full p-1 text-gray-500 hover:bg-gray-100 hover:text-danger"
              aria-label="Remove video"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => videoInputRef.current?.click()}
            disabled={isUploadingVideo}
            className="self-start"
          >
            {isUploadingVideo ? "Uploading…" : "Add video"}
          </Button>
        )}
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          onChange={handleVideoFileChange}
          disabled={isUploadingVideo}
          className="hidden"
        />
        <p className="text-xs text-gray-500">MP4, WEBM, or MOV, max 25MB.</p>
      </div>

      {mediaError && <AlertBox tone="danger">{mediaError}</AlertBox>}

      <FormSelect
        label="Refund to"
        value={refundMethod}
        onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
      >
        <option value="WALLET">Kisan4U Wallet</option>
        {!isCod && <option value="ORIGINAL_SOURCE">Same account I paid with</option>}
        {isCod && <option value="BANK_TRANSFER">Bank account</option>}
      </FormSelect>
      {refundMethod === "BANK_TRANSFER" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <FormInput
            label="Account holder name"
            value={bankAccountHolderName}
            onChange={(e) => setBankAccountHolderName(e.target.value)}
            required
          />
          <FormInput
            label="Account number"
            value={bankAccountNumber}
            onChange={(e) => setBankAccountNumber(e.target.value)}
            required
          />
          <FormInput
            label="IFSC code"
            value={bankIfsc}
            onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
            required
          />
        </div>
      )}
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isPending || isUploadingImage || isUploadingVideo}
        >
          {isPending ? "Submitting…" : "Submit return request"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowForm(false)}
          disabled={isPending}
        >
          Never mind
        </Button>
      </div>
    </form>
  );
}
