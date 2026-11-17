"use client";

import { Button, FormInput, FormTextarea, AlertBox, SectionHeader } from "@kisan4u/ui";
import type { PaymentMethod } from "@kisan4u/db";
import { MoneyAmountInput } from "@/components/money-amount-input";
import type { PosCheckoutPreview } from "../actions";
import { computePosPayableAmounts } from "../lib/pos-amounts";

const PAYMENT_LABEL: Record<string, string> = {
  COD: "Cash on Delivery",
  ONLINE_FULL: "Full Prepaid",
  ONLINE_PARTIAL: "Partial Prepaid",
  TRANSPORT_FULL_ONLINE: "Full Prepaid (Transport)",
};

export function CheckoutPanel({
  role,
  preview,
  deliveryMethod,
  onDeliveryMethodChange,
  paymentMethod,
  onPaymentMethodChange,
  transportNote,
  onTransportNoteChange,
  walletAmountInput,
  onWalletAmountInputChange,
  posAdvanceAmountInput,
  onPosAdvanceAmountInputChange,
  couponCodeInput,
  onCouponCodeInputChange,
  appliedCouponCode,
  onApplyCoupon,
  onRemoveCoupon,
}: {
  role: "CUSTOMER" | "DEALER";
  preview: PosCheckoutPreview | null;
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  onDeliveryMethodChange: (method: "KISAN4U_COURIER" | "TRANSPORT") => void;
  paymentMethod: PaymentMethod | "";
  onPaymentMethodChange: (method: PaymentMethod) => void;
  transportNote: string;
  onTransportNoteChange: (note: string) => void;
  walletAmountInput: number;
  onWalletAmountInputChange: (amount: number) => void;
  /** ONLINE_PARTIAL only — the amount to collect now, typed by the operator. Ignored for every other payment method. */
  posAdvanceAmountInput: number;
  onPosAdvanceAmountInputChange: (amount: number) => void;
  couponCodeInput: string;
  onCouponCodeInputChange: (code: string) => void;
  /** Only set once "Apply" is clicked — this is what's actually sent to the preview/place-order actions, not every keystroke. */
  appliedCouponCode: string | undefined;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
}) {
  const grandTotal = preview?.draft.ok ? preview.draft.grandTotal : 0;
  const isPartial = paymentMethod === "ONLINE_PARTIAL";
  const walletBalance = preview?.wallet.balance ?? 0;
  const { walletEligibleCap, walletApplied, payableAfterWallet, remainingPayableNow, codDue } = computePosPayableAmounts(
    preview,
    paymentMethod,
    walletAmountInput,
    posAdvanceAmountInput,
  );
  const discountAmount = preview?.draft.ok
    ? preview.draft.drafts.reduce((t, d) => t + d.promoDiscountAmount, 0)
    : 0;
  const netTaxAmount = preview?.draft.ok ? preview.draft.customerTaxTotal : 0;
  const couponError = appliedCouponCode && preview?.draft.ok === false ? preview.draft.error : null;
  const appliedCoupon = preview?.draft.ok ? preview.draft.appliedCoupon : null;

  return (
    <div className="flex flex-col gap-5">
      {role === "DEALER" && (
        <div>
          <SectionHeader title="Delivery Method" />
          <div className="flex flex-col gap-2">
            {(["TRANSPORT", "KISAN4U_COURIER"] as const).map((method) => (
              <label
                key={method}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border-[1.5px] p-3 text-sm font-semibold ${deliveryMethod === method ? "border-green-600 bg-green-50" : "border-border"}`}
              >
                <input
                  type="radio"
                  name="pos-delivery"
                  checked={deliveryMethod === method}
                  onChange={() => onDeliveryMethodChange(method)}
                />
                {method === "TRANSPORT"
                  ? "Transport (₹0 shipping, arranged privately)"
                  : "Courier (shipping charged)"}
              </label>
            ))}
          </div>
          {deliveryMethod === "TRANSPORT" && (
            <div className="mt-3">
              <FormTextarea
                label="Transport name / note"
                value={transportNote}
                onChange={(e) => onTransportNoteChange(e.target.value)}
                required
                rows={2}
                maxLength={300}
              />
            </div>
          )}
        </div>
      )}

      <div>
        <SectionHeader title="Payment Method" />
        <div className="flex flex-col gap-2">
          {(preview?.allowedPaymentMethods ?? []).map((method) => (
            <label
              key={method}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border-[1.5px] p-3 text-sm font-semibold ${paymentMethod === method ? "border-green-600 bg-green-50" : "border-border"}`}
            >
              <input
                type="radio"
                name="pos-payment"
                checked={paymentMethod === method}
                onChange={() => onPaymentMethodChange(method)}
              />
              {PAYMENT_LABEL[method] ?? method}
            </label>
          ))}
        </div>
      </div>

      {walletBalance > 0 && (
        <div>
          <SectionHeader title="Wallet" />
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span>Wallet balance</span>
              <span className="font-semibold text-ink">₹{walletBalance.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <MoneyAmountInput
                label=""
                value={walletAmountInput}
                onChange={onWalletAmountInputChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onWalletAmountInputChange(walletEligibleCap)}
              >
                Use max
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Up to ₹{walletEligibleCap.toFixed(2)} can be applied — it comes off the order total
              first, then the payment method below applies to what is left.
            </p>
          </div>
        </div>
      )}

      {isPartial && payableAfterWallet > 0 && (
        <div>
          <SectionHeader title="Partial Payment" />
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <MoneyAmountInput
              label={
                walletApplied > 0
                  ? `Amount to collect now (of ₹${payableAfterWallet.toFixed(2)} left after the wallet)`
                  : "Amount to collect now"
              }
              value={posAdvanceAmountInput}
              onChange={onPosAdvanceAmountInputChange}
            />
            <p className="text-xs text-gray-500">
              Remaining on delivery (COD): ₹{codDue.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      <div>
        <SectionHeader title="Coupon" />
        {appliedCouponCode ? (
          <div className="flex items-center justify-between rounded-lg border-[1.5px] border-green-600 bg-green-50 p-3 text-sm font-semibold">
            <span>
              {appliedCouponCode}
              {appliedCoupon && (
                <span className="ml-2 font-normal text-success">
                  −₹{appliedCoupon.totalDiscount.toFixed(2)} applied
                </span>
              )}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onRemoveCoupon}>
              Remove
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <FormInput
              label=""
              value={couponCodeInput}
              onChange={(e) => onCouponCodeInputChange(e.target.value)}
              placeholder="Enter coupon code"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!couponCodeInput.trim()}
              onClick={onApplyCoupon}
            >
              Apply
            </Button>
          </div>
        )}
        {couponError && <p className="mt-1 text-xs font-semibold text-danger">{couponError}</p>}
      </div>

      <div>
        <SectionHeader title="Order Summary" />
        <div className="flex flex-col gap-1.5 rounded-lg bg-green-50 p-3.5 text-sm">
          {preview?.draft.ok ? (
            <>
              <div className="flex justify-between">
                <span>Total Price</span>
                <span>₹{preview.draft.drafts.reduce((t, d) => t + d.subtotal, 0).toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-success">
                  <span>Extra Discount</span>
                  <span>−₹{discountAmount.toFixed(2)}</span>
                </div>
              )}
              {appliedCoupon && (
                <div className="flex justify-between text-success">
                  <span>Coupon ({appliedCoupon.code})</span>
                  <span>−₹{appliedCoupon.totalDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Tax</span>
                <span>₹{netTaxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>
                  ₹
                  {preview.draft.drafts
                    .reduce((t, d) => t + d.charges.customerPayableDelivery, 0)
                    .toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between border-t border-green-100 pt-1.5 text-base font-extrabold text-ink">
                <span>Total Order Value</span>
                <span>₹{grandTotal.toFixed(2)}</span>
              </div>
              {walletApplied > 0 && (
                <div className="text-xs font-semibold text-success">
                  Wallet applied: −₹{walletApplied.toFixed(2)}
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-ink">
                <span>Amount to pay online now</span>
                <span>₹{remainingPayableNow.toFixed(2)}</span>
              </div>
              {codDue > 0 && (
                <div className="flex justify-between text-sm font-bold text-ink">
                  <span>Balance to collect on delivery (COD)</span>
                  <span>₹{codDue.toFixed(2)}</span>
                </div>
              )}
            </>
          ) : (
            <AlertBox tone="danger">
              {preview?.draft.ok === false
                ? preview.draft.error
                : "Add products to see the order summary."}
            </AlertBox>
          )}
        </div>
      </div>

      {paymentMethod !== "COD" && paymentMethod !== "" && remainingPayableNow > 0 && (
        <AlertBox tone="info">
          The order will place immediately — payment proof (a screenshot of the amount received)
          is uploaded afterward from "My orders" and reviewed by an admin before this order can be
          dispatched.
        </AlertBox>
      )}
    </div>
  );
}
