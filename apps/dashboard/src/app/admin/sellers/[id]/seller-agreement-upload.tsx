"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { AlertBox, Button } from "@kisan4u/ui";
import { uploadSellerAgreementAction } from "./actions";

/** Upload / replace control for the seller detail page's "Seller Agreement" tab. PDF only, 8 MB — re-checked server-side. */
export function SellerAgreementUpload({
  sellerProfileId,
  hasAgreement,
}: {
  sellerProfileId: string;
  hasAgreement: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setDone(false);
    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const result = await uploadSellerAgreementAction(sellerProfileId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          disabled={isPending}
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name ?? null);
            setError(null);
            setDone(false);
          }}
          className="text-sm text-gray-700 file:mr-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-xs file:font-bold"
        />
        <Button variant="primary" size="sm" onClick={submit} disabled={!fileName} loading={isPending}>
          <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {hasAgreement ? "Replace agreement" : "Upload agreement"}
        </Button>
      </div>
      <p className="text-xs text-gray-500">PDF only, up to 8 MB. The seller can view it under Account → Agreement.</p>
      {error && <AlertBox tone="danger">{error}</AlertBox>}
      {done && <AlertBox tone="success">Agreement uploaded.</AlertBox>}
    </div>
  );
}
