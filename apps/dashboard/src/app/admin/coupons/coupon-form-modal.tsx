"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertBox, Button, FormInput, FormSelect, Modal, toDateInputValue } from "@kisan4u/ui";
import { CalendarDateField } from "@/components/calendar-date-field";
import { createCouponAction, updateCouponAction } from "./actions";
import type { CouponRow } from "./coupons-table";

type Audience = CouponRow["audience"];
type DiscountType = "FLAT" | "PERCENTAGE";

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "CUSTOMER_ONLY", label: "Customer only" },
  { value: "DEALER_ONLY", label: "Dealer only" },
  { value: "BOTH_CUSTOMER_AND_DEALER", label: "Both customer and dealer" },
];

// No 0/O or 1/I so a generated code survives being read out over the phone.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. "K4U-7HD2QX" — passes couponCodeSchema (A-Z, 0-9, hyphen). Duplicates are still rejected server-side. */
function generateCouponCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `K4U-${suffix}`;
}

export function CouponFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: CouponRow | null;
}) {
  const isEdit = editing !== null;

  const [code, setCode] = useState("");
  const [audience, setAudience] = useState<Audience>("BOTH_CUSTOMER_AND_DEALER");
  const [discountType, setDiscountType] = useState<DiscountType>("FLAT");
  const [discountValue, setDiscountValue] = useState("");
  const [minPurchase, setMinPurchase] = useState("0");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perUserLimit, setPerUserLimit] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Re-seed the form whenever a different row is opened for editing (or the
  // modal opens fresh for "New Coupon") — reset() alone (only called on
  // close) wouldn't repopulate a SECOND edit click without a full page
  // reload in between.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCode(editing.code);
      setAudience(editing.audience);
      setDiscountType(editing.discountType === "PERCENTAGE" ? "PERCENTAGE" : "FLAT");
      setDiscountValue(String(editing.discountValue));
      setMinPurchase(String(editing.minPurchase));
      setMaxDiscount(editing.maxDiscount !== null ? String(editing.maxDiscount) : "");
      setUsageLimit(editing.usageLimit !== null ? String(editing.usageLimit) : "");
      setPerUserLimit(editing.perUserLimit !== null ? String(editing.perUserLimit) : "");
      setStartDate(toDateInputValue(editing.startDate));
      setEndDate(toDateInputValue(editing.endDate));
      setIsActive(editing.isActive);
    } else {
      setCode("");
      setAudience("BOTH_CUSTOMER_AND_DEALER");
      setDiscountType("FLAT");
      setDiscountValue("");
      setMinPurchase("0");
      setMaxDiscount("");
      setUsageLimit("");
      setPerUserLimit("");
      setStartDate("");
      setEndDate("");
      setIsActive(true);
    }
    setError(null);
  }, [open, editing]);

  function handleSubmit() {
    setError(null);
    if (!code.trim()) return setError("Enter a coupon code.");
    if (!discountValue) return setError("Enter a discount value.");
    if (!startDate || !endDate) return setError("Select a validity start and end date.");

    const input = {
      code,
      audience,
      discountType,
      discountValue,
      minPurchase: minPurchase || "0",
      maxDiscount: discountType === "PERCENTAGE" && maxDiscount ? maxDiscount : undefined,
      usageLimit: usageLimit || undefined,
      perUserLimit: perUserLimit || undefined,
      startDate,
      endDate,
      isActive,
    };

    startTransition(async () => {
      const result = isEdit
        ? await updateCouponAction({ ...input, id: editing.id })
        : await createCouponAction(input);
      if (!result.ok) return setError(result.error);
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit coupon" : "New coupon"} className="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <FormInput
              label="Coupon code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Type a code (e.g. SAVE50) or generate one"
              required
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCode(generateCouponCode())}
            disabled={isPending}
          >
            Generate
          </Button>
        </div>

        <div>
          <h3 className="mb-1 text-[13px] font-bold text-ink">Who can use it</h3>
          <FormSelect
            label=""
            aria-label="Audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FormSelect>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <h3 className="mb-1 text-[13px] font-bold text-ink">Discount type</h3>
            <FormSelect
              label=""
              aria-label="Discount type"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as DiscountType)}
            >
              <option value="FLAT">Flat amount (₹)</option>
              <option value="PERCENTAGE">Percentage (%)</option>
            </FormSelect>
          </div>
          <FormInput
            label={discountType === "PERCENTAGE" ? "Discount %" : "Discount ₹"}
            type="number"
            min={0}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            required
          />
        </div>

        {discountType === "PERCENTAGE" && (
          <FormInput
            label="Max discount amount (₹) — optional cap"
            type="number"
            min={0}
            value={maxDiscount}
            onChange={(e) => setMaxDiscount(e.target.value)}
          />
        )}

        <FormInput
          label="Minimum order value (₹)"
          type="number"
          min={0}
          value={minPurchase}
          onChange={(e) => setMinPurchase(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Total usage limit (optional)"
            type="number"
            min={1}
            value={usageLimit}
            onChange={(e) => setUsageLimit(e.target.value)}
            placeholder="Unlimited"
          />
          <FormInput
            label="Per-user limit (optional)"
            type="number"
            min={1}
            value={perUserLimit}
            onChange={(e) => setPerUserLimit(e.target.value)}
            placeholder="Unlimited"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CalendarDateField label="Valid from" value={startDate} onChange={setStartDate} />
          <CalendarDateField label="Valid until" value={endDate} onChange={setEndDate} />
        </div>

        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>

        {error && <AlertBox tone="danger">{error}</AlertBox>}

        <div className="flex gap-2">
          <Button type="button" loading={isPending} onClick={handleSubmit}>
            {isEdit ? "Save changes" : "Create coupon"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
