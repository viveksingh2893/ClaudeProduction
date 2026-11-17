"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  AlertBox,
  Button,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  StarRatingInput,
} from "@kisan4u/ui";
import type { ReviewModerationStatus } from "@kisan4u/db";
import { createManualReviewAction, searchProductsForReviewAction } from "./actions";

type PickedProduct = { id: string; name: string; primaryImageUrl: string | null };

/**
 * "Genuine feedback collected outside the website" — call centre,
 * WhatsApp, etc. Deliberately NOT a fake-review generator: consent is a
 * required checkbox before this can be saved as anything other than
 * Pending, and the created row can never carry the Verified Purchase
 * badge (createManualReview hard-codes verifiedPurchase false — see its
 * doc comment).
 */
export function ManualReviewButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [rating, setRating] = useState(5);
  const [customerDisplayName, setCustomerDisplayName] = useState("");
  const [comment, setComment] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [moderationStatus, setModerationStatus] = useState<ReviewModerationStatus>("PENDING");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSearching, startSearch] = useTransition();

  function reset() {
    setProduct(null);
    setQuery("");
    setResults([]);
    setRating(5);
    setCustomerDisplayName("");
    setComment("");
    setSourceReference("");
    setConsentConfirmed(false);
    setModerationStatus("PENDING");
    setError(null);
  }

  function runSearch(q: string) {
    setQuery(q);
    startSearch(async () => {
      setResults(await searchProductsForReviewAction(q));
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!product) {
      setError("Pick a product first.");
      return;
    }
    if (moderationStatus === "APPROVED" && !consentConfirmed) {
      setError(
        "Confirm the customer gave permission to publish before setting status to Approved.",
      );
      return;
    }
    startTransition(async () => {
      const result = await createManualReviewAction({
        productId: product.id,
        customerDisplayName,
        rating,
        comment: comment || undefined,
        sourceReference: sourceReference || undefined,
        consentConfirmed,
        moderationStatus,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add manual review
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add manual/offline review">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-semibold text-gray-600">
              Product <span className="text-danger">*</span>
            </label>
            {product ? (
              <div className="flex items-center justify-between rounded-md border-[1.5px] border-green-600 bg-green-50 px-3 py-2 text-sm">
                <span className="font-semibold text-ink">{product.name}</span>
                <button
                  type="button"
                  onClick={() => setProduct(null)}
                  className="text-xs font-bold text-green-700 hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  placeholder="Search by product name…"
                  value={query}
                  onChange={(e) => runSearch(e.target.value)}
                  onFocus={() => !results.length && runSearch("")}
                  className="w-full rounded-md border-[1.5px] border-border px-3 py-2.5 text-sm outline-none focus:border-green-600"
                />
                {isSearching && <p className="text-xs text-gray-500">Searching…</p>}
                {results.length > 0 && (
                  <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1">
                    {results.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setProduct(p)}
                          className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-green-50"
                        >
                          {p.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-semibold text-gray-600">Rating</label>
            <StarRatingInput value={rating} onChange={setRating} />
          </div>

          <FormInput
            label="Customer display name"
            required
            value={customerDisplayName}
            onChange={(e) => setCustomerDisplayName(e.target.value)}
          />
          <FormTextarea
            label="Comment"
            hint="Optional"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <FormInput
            label="Internal source / reference"
            hint="e.g. Call centre ticket #1234, WhatsApp thread — admin-only, never shown publicly"
            value={sourceReference}
            onChange={(e) => setSourceReference(e.target.value)}
          />

          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={consentConfirmed}
              onChange={(e) => setConsentConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            The customer gave permission for this feedback to be published.
          </label>

          <FormSelect
            label="Publication status"
            value={moderationStatus}
            onChange={(e) => setModerationStatus(e.target.value as ReviewModerationStatus)}
          >
            <option value="PENDING">Pending (save without publishing)</option>
            <option value="APPROVED">Approved (publish now)</option>
          </FormSelect>

          {error && <AlertBox tone="danger">{error}</AlertBox>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isPending}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
