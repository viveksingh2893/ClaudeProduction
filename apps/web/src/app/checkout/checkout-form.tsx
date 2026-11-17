"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  getCustomerPromoDiscountPercent,
  getCustomerPromoDiscountLabel,
  computeAdvanceAmountPure,
  isValidIndianMobileLocal,
  type PromoPaymentMethod,
} from "@kisan4u/validators";
import {
  AlertBox,
  Button,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  SectionHeader,
} from "@kisan4u/ui";
import {
  abandonCheckoutAction,
  claimGuestCartAction,
  discardGuestCartAction,
  placeOrderAction,
  previewCouponAction,
  requestDealerCheckoutOtpAction,
  requestGuestOtpAction,
  verifyRazorpayPaymentAction,
} from "./actions";
import { createProposedOrderAction } from "../account/ba/actions";
import type { MetaCartSummary } from "@/lib/meta/shared";
import { trackAddPaymentInfo } from "@/lib/meta/track";
import {
  OtpExpiredNotice,
  OtpResendButton,
  useOtpFailureCounter,
  useOtpTimers,
} from "@/components/otp-controls";

// Bridges the half-typed address + "existing vs new" welcome flag across
// the single router.refresh() that happens when a guest verifies their
// number mid-checkout (the cart itself is server-side and never at risk;
// only this in-progress form state needs carrying over). Cleared once the
// order is actually placed.
const GUEST_ADDRESS_KEY = "k4u_checkout_guest_address";
const GUEST_WELCOME_KEY = "k4u_checkout_welcome";

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; contact?: string };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

// Razorpay's own docs require loading the Checkout widget FROM their
// domain (never self-hosted/mirrored) — injected on demand, only for a
// checkout that actually needs it, not on every page load regardless of
// payment method.
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const PAYMENT_LABEL: Record<string, string> = {
  COD: "Cash on Delivery",
  ONLINE_FULL: "Pay the full amount online now",
  ONLINE_PARTIAL: "Pay part online now, rest on delivery",
  TRANSPORT_FULL_ONLINE: "Pay the full amount online (Transport)",
};

type Address = {
  id: string;
  fullName: string;
  line1: string;
  cityTown: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

/** A referred customer's saved address — same fields proposedOrderCreateSchema's typed `address` accepts, plus the id so it can be sent as `savedAddressId`. */
type RefereeAddress = {
  id: string;
  fullName: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string | null;
  state: string;
  stateId: string | null;
  pincode: string;
};

/** A customer this signed-in Business Associate has referred — offered as an "Order for" pick in checkout instead of "Myself". */
type ReferredCustomer = {
  id: string;
  name: string;
  addresses: RefereeAddress[];
};

/** One line of the buyer's own cart, as already priced/validated server-side in checkout/page.tsx's buildCheckoutDrafts — reused verbatim to build a proposed order's `lines` when checking out on a referee's behalf. */
type CartLine = { productId: string; variantId: string | null; quantity: number };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Same rule/duplication reasoning as round2 above — see packages/orders/src/money.ts's roundUpToRupee, the server-side source of truth this mirrors for instant client-side preview. */
function roundUpToRupee(value: number): number {
  return Math.ceil(value - 1e-9);
}

/** One per Place Order attempt — regenerated after a failed attempt so a retry isn't blocked by the spent key. */
function freshIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function CheckoutForm({
  role,
  isGuest,
  deliveryMethod,
  addresses,
  states,
  dealerLockedState,
  allowedPaymentMethods,
  sellerSubtotals,
  sellingPriceTotal,
  taxTotal,
  deliveryChargeTotal,
  grossTotal,
  advancePreview,
  partialPaymentRule,
  walletBalance,
  referredCustomers,
  cartLines,
  metaCart,
}: {
  /** SKUs + total for Meta's "AddPaymentInfo" event, fired when the order is submitted (see app/checkout/page.tsx). */
  metaCart: MetaCartSummary;
  role: "CUSTOMER" | "DEALER";
  /** No session — checking out against a guest placeholder. Must OTP-verify a mobile number (which signs them in / creates their account) before the order can be placed. */
  isGuest: boolean;
  deliveryMethod: "KISAN4U_COURIER" | "TRANSPORT";
  addresses: Address[];
  states: { id: string; name: string }[];
  dealerLockedState: { id: string; name: string } | null;
  allowedPaymentMethods: string[];
  /** Each seller order's own merchandise subtotal (post product-discount) — used only to recompute the customer promo discount preview instantly on the client; the server always recomputes it authoritatively from the submitted payment method. */
  sellerSubtotals: number[];
  /** Selling price row — sum of every seller order's subtotal (post product-discount, pre-tax). Never includes the seller-borne collection charge. */
  sellingPriceTotal: number;
  /** Tax row — net tax actually billed to the customer (BuildDraftsResult.customerTaxTotal). */
  taxTotal: number;
  /** Delivery charge row — 0 for a customer order (seller-borne), the calculated courier cost for a dealer Kisan4U Courier order, 0 for dealer Transport. Never includes the collection charge, which is always seller-borne and never shown to the buyer. */
  deliveryChargeTotal: number;
  /** Pre-discount total (subtotal + tax + delivery-charge-to-customer). */
  grossTotal: number;
  advancePreview: { advanceAmount: number; remainingAmount: number; ruleLabel: string } | null;
  partialPaymentRule: {
    ruleType: "PERCENTAGE" | "FIXED_AMOUNT" | "MIN_ADVANCE_PERCENTAGE";
    value: number;
    label: string;
  } | null;
  /** Kisan4U Wallet balance, ₹ — an additive funding source applied on top of whichever payment method is chosen below, never a payment method of its own. */
  walletBalance: number;
  /** Non-null and non-empty only for an approved/bank-pending Business Associate — the customers they've referred, offered as an "Order for" pick above the address section. Null for every other buyer (99% of checkouts), in which case nothing about this form changes. */
  referredCustomers: ReferredCustomer[] | null;
  /** The signed-in buyer's own cart lines, exactly as priced by buildCheckoutDrafts on the server — reused as the proposed order's `lines` when checking out on a referee's behalf instead of re-deriving anything client-side. */
  cartLines: CartLine[];
}) {
  const router = useRouter();
  const [addressMode, setAddressMode] = useState<"existing" | "new">(
    addresses.length > 0 ? "existing" : "new",
  );
  const [addressId, setAddressId] = useState(
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? "",
  );
  const [newAddress, setNewAddress] = useState({
    fullName: "",
    mobile: "",
    altMobile: "",
    line1: "",
    line2: "",
    landmark: "",
    cityTown: "",
    district: "",
    state: dealerLockedState ? dealerLockedState.name : "",
    stateId: dealerLockedState ? dealerLockedState.id : "",
    pincode: "",
    addressType: "HOME",
    isDefault: false,
  });
  const [paymentMethod, setPaymentMethod] = useState(allowedPaymentMethods[0] ?? "");
  const [transportNote, setTransportNote] = useState("");
  const [walletAmountInput, setWalletAmountInput] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => freshIdempotencyKey());

  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; totalDiscount: number } | null>(
    null,
  );
  const [couponError, setCouponError] = useState<string | null>(null);
  const [isCouponPending, startCouponTransition] = useTransition();

  function handleApplyCoupon() {
    const code = couponCodeInput.trim();
    if (!code) return;
    setCouponError(null);
    startCouponTransition(async () => {
      const result = await previewCouponAction({
        couponCode: code,
        deliveryMethod,
        paymentMethod: (paymentMethod || "COD") as
          | "COD"
          | "ONLINE_FULL"
          | "ONLINE_PARTIAL"
          | "TRANSPORT_FULL_ONLINE",
      });
      if (!result.ok) {
        setCouponError(result.error);
        setAppliedCoupon(null);
        return;
      }
      setAppliedCoupon({ code: result.code, totalDiscount: result.totalDiscount });
    });
  }

  function handleRemoveCoupon() {
    setAppliedCoupon(null);
    setCouponCodeInput("");
    setCouponError(null);
  }

  // ---- BA "order for a referee" (only ever active when referredCustomers
  // is non-empty) — "" always means "Myself", the default, so a buyer who
  // never touches this control sees zero behavior change. ------------------
  const [orderForId, setOrderForId] = useState("");
  const selectedReferee = orderForId
    ? (referredCustomers?.find((c) => c.id === orderForId) ?? null)
    : null;
  const isForReferee = selectedReferee !== null;
  const effectiveAddresses: Address[] = selectedReferee
    ? selectedReferee.addresses.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        line1: a.line1,
        cityTown: a.cityTown,
        state: a.state,
        pincode: a.pincode,
        isDefault: false,
      }))
    : addresses;

  // Re-point the existing/new address toggle at the newly-selected target's
  // own address book. Skipped on first mount so the normal "Myself" default
  // (which prefers the buyer's default address) is left exactly as it was —
  // this only ever runs after the buyer actively changes who they're
  // ordering for, which requires referredCustomers to be non-empty.
  const orderForMounted = useRef(false);
  useEffect(() => {
    if (!orderForMounted.current) {
      orderForMounted.current = true;
      return;
    }
    const list = orderForId
      ? (referredCustomers?.find((c) => c.id === orderForId)?.addresses ?? [])
      : addresses;
    setAddressMode(list.length > 0 ? "existing" : "new");
    setAddressId(list[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderForId]);

  // A referee's order is always Cash on Delivery — enforced server-side in
  // createProposedOrder, mirrored here so the payment UI never even offers
  // another option while a referee is selected.
  useEffect(() => {
    if (isForReferee) setPaymentMethod("COD");
  }, [isForReferee]);

  // ---- Guest mobile verification (only ever active while isGuest) --------
  const [otpStage, setOtpStage] = useState<"idle" | "dealer-confirm" | "sent" | "signing">("idle");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpIsExisting, setOtpIsExisting] = useState(false);
  // The number just verified turned out to be a registered dealer's — on
  // success this signs into the dealer account (not the guest's customer
  // one) and discards the guest cart instead of claiming it.
  const [isDealerFlow, setIsDealerFlow] = useState(false);
  const [otpPending, startOtpTransition] = useTransition();
  // autoStart:false — the clock only runs once a code has actually been sent.
  const otpTimers = useOtpTimers({ autoStart: false });
  const { recordFailure: recordOtpFailure, resetFailures: resetOtpFailures } =
    useOtpFailureCounter();
  const [welcomeBanner, setWelcomeBanner] = useState<"existing" | "new" | null>(null);
  const rehydrated = useRef(false);

  // After the post-verification refresh the visitor is signed in, so this
  // component re-renders with isGuest=false. Pull the address they had
  // half-typed (new customers land on an empty form) and the "you're
  // already registered" flag back out of sessionStorage.
  useEffect(() => {
    if (isGuest || rehydrated.current) return;
    rehydrated.current = true;
    try {
      const welcome = sessionStorage.getItem(GUEST_WELCOME_KEY);
      if (welcome === "existing" || welcome === "new") setWelcomeBanner(welcome);
      sessionStorage.removeItem(GUEST_WELCOME_KEY);

      if (addresses.length === 0) {
        const saved = sessionStorage.getItem(GUEST_ADDRESS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<typeof newAddress>;
          setNewAddress((v) => ({ ...v, ...parsed }));
          setAddressMode("new");
        }
      }
    } catch {
      /* sessionStorage unavailable — nothing to restore */
    }
  }, [isGuest, addresses.length]);

  function handleRequestGuestOtp() {
    setOtpError(null);
    const phone = newAddress.mobile.trim();
    if (!isValidIndianMobileLocal(phone)) {
      setOtpError("Enter a valid 10-digit Indian mobile number first.");
      return;
    }
    startOtpTransition(async () => {
      const result = await requestGuestOtpAction(phone);
      if (!result.ok) {
        if (result.retryAfter) otpTimers.limitResend(result.retryAfter);
        setOtpError(result.error);
        return;
      }
      setOtpPhone(phone);
      if (result.isDealer) {
        // No code sent yet — ask for confirmation first, since continuing
        // erases this guest cart (see handleConfirmDealerCheckout).
        setIsDealerFlow(true);
        setOtpStage("dealer-confirm");
        return;
      }
      setIsDealerFlow(false);
      setOtpIsExisting(result.isExistingCustomer);
      setOtpCode("");
      setOtpStage("sent");
      otpTimers.restart();
    });
  }

  /** The buyer said OK on the "this will erase your cart" dealer prompt — now actually send the code. Also used to resend, once already in the OTP-entry step. */
  function handleConfirmDealerCheckout() {
    setOtpError(null);
    startOtpTransition(async () => {
      const result = await requestDealerCheckoutOtpAction(otpPhone);
      if (!result.ok) {
        if (result.retryAfter) otpTimers.limitResend(result.retryAfter);
        setOtpError(result.error);
        setOtpStage("idle");
        setIsDealerFlow(false);
        return;
      }
      setOtpCode("");
      setOtpStage("sent");
      otpTimers.restart();
    });
  }

  /** The buyer said No — let them enter a different number. */
  function handleDeclineDealerCheckout() {
    setOtpStage("idle");
    setIsDealerFlow(false);
    setOtpPhone("");
    setOtpError(null);
    setNewAddressField("mobile", "");
  }

  function handleConfirmGuestOtp() {
    if (otpTimers.expired) return;
    setOtpError(null);
    if (!/^\d{6}$/.test(otpCode)) {
      setOtpError("Enter the 6-digit code.");
      return;
    }
    startOtpTransition(async () => {
      setOtpStage("signing");
      if (!isDealerFlow) {
        try {
          sessionStorage.setItem(GUEST_ADDRESS_KEY, JSON.stringify(newAddress));
          sessionStorage.setItem(GUEST_WELCOME_KEY, otpIsExisting ? "existing" : "new");
        } catch {
          /* ignore — the refresh still works, only the form pre-fill is lost */
        }
      }
      // signIn("otp") is what consumes the code: it signs into the existing
      // customer account for this number (or auto-provisions one), or —
      // for the dealer flow — the existing dealer account, exactly like
      // /dealer/otp's normal dealer login.
      const res = await signIn("otp", {
        phone: otpPhone,
        code: otpCode,
        role: isDealerFlow ? "DEALER" : "CUSTOMER",
        purpose: "guest_checkout",
        redirect: false,
      });
      if (res?.error) {
        const attemptsLeft = recordOtpFailure();
        if (attemptsLeft === 0) {
          // Five wrong codes: back to the mobile-number step to start over.
          setOtpStage("idle");
          setOtpCode("");
          otpTimers.stop();
          resetOtpFailures();
          setIsDealerFlow(false);
          setOtpError("Too many incorrect OTP attempts. Please verify your mobile number again.");
          return;
        }
        setOtpStage("sent");
        setOtpCode("");
        setOtpError(
          `That code didn't work — check it and try again, or resend. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
        );
        return;
      }
      if (isDealerFlow) {
        // A dealer has their own account/cart — the guest cart being built
        // here was already flagged for erasure before this point, not
        // claimed onto the dealer account.
        try {
          await discardGuestCartAction();
        } catch {
          /* non-fatal */
        }
        router.push("/");
        router.refresh();
        return;
      }
      // Move the guest cart onto the account we just signed into. Never
      // block the flow on this — worst case the cart page reconciles it.
      try {
        await claimGuestCartAction();
      } catch {
        /* non-fatal */
      }
      router.refresh();
    });
  }

  // Recalculated on the client the instant the payment method changes — a
  // preview only; checkout() on the server always recomputes this from
  // scratch using the authoritative submitted paymentMethod, never trusts
  // this number (there is no discount field in the submitted payload at
  // all — see checkoutInputSchema).
  const subtotalSum = useMemo(
    () => round2(sellerSubtotals.reduce((total, v) => total + v, 0)),
    [sellerSubtotals],
  );
  const discountPercent = getCustomerPromoDiscountPercent(
    role,
    (paymentMethod || "COD") as PromoPaymentMethod,
  );
  const discountAmount = role === "CUSTOMER" ? round2((subtotalSum * discountPercent) / 100) : 0;
  const discountLabel = getCustomerPromoDiscountLabel(discountPercent);
  // Rounded UP to the next whole rupee to match the server's authoritative
  // grandTotal (see packages/orders/src/checkout-draft.ts) — every figure
  // derived below (partial-payment advance, wallet cap, remaining payable)
  // must be computed from this same rounded total or the live preview
  // would drift a few paise from what checkout() actually charges.
  const couponDiscount = appliedCoupon?.totalDiscount ?? 0;
  const netTotal = roundUpToRupee(grossTotal - discountAmount - couponDiscount);

  // The wallet comes off the WHOLE order first, whichever payment method is
  // selected; COD / partial prepaid / full prepaid then work on what is left
  // (see checkout() in packages/orders/src/checkout.ts, which plans it the
  // same way). A proposed order on a referee's behalf never uses the
  // buyer's wallet.
  const walletEligibleCap = isForReferee ? 0 : Math.max(0, Math.min(walletBalance, netTotal));
  const walletApplied = round2(Math.min(Math.max(0, walletAmountInput), walletEligibleCap));
  const payableAfterWallet = round2(netTotal - walletApplied);

  // The advance rule applies to the post-wallet amount. Null when nothing is
  // left to split (the wallet covers the whole order).
  const livePartialPreview = useMemo(() => {
    if (paymentMethod !== "ONLINE_PARTIAL" || payableAfterWallet <= 0) return null;
    if (partialPaymentRule) {
      const { advanceAmount, remainingAmount } = computeAdvanceAmountPure(
        payableAfterWallet,
        partialPaymentRule.ruleType,
        partialPaymentRule.value,
      );
      return { advanceAmount, remainingAmount, ruleLabel: partialPaymentRule.label };
    }
    return advancePreview;
  }, [paymentMethod, partialPaymentRule, payableAfterWallet, advancePreview]);

  function setNewAddressField<K extends keyof typeof newAddress>(
    key: K,
    value: (typeof newAddress)[K],
  ) {
    setNewAddress((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isForReferee && selectedReferee) {
      if (addressMode === "existing" && !addressId) {
        setError("Select a delivery address for this customer.");
        return;
      }
      startTransition(async () => {
        const payload: Record<string, unknown> = {
          refereeUserId: selectedReferee.id,
          lines: cartLines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
          })),
        };
        if (addressMode === "existing") {
          payload.savedAddressId = addressId;
        } else {
          payload.address = {
            fullName: newAddress.fullName,
            mobile: newAddress.mobile,
            line1: newAddress.line1,
            line2: newAddress.line2 || undefined,
            landmark: newAddress.landmark || undefined,
            cityTown: newAddress.cityTown,
            district: newAddress.district,
            state: newAddress.state,
            stateId: newAddress.stateId,
            pincode: newAddress.pincode,
          };
        }

        const result = await createProposedOrderAction(payload);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push("/account/ba");
      });
      return;
    }

    startTransition(async () => {
      const payload: Record<string, unknown> = {
        deliveryMethod,
        paymentMethod,
        transportNote: deliveryMethod === "TRANSPORT" ? transportNote || undefined : undefined,
        walletAmountApplied: walletApplied > 0 ? walletApplied : undefined,
        idempotencyKey,
        couponCode: appliedCoupon?.code,
      };
      if (addressMode === "existing") {
        if (!addressId) {
          setError("Select a delivery address.");
          return;
        }
        payload.addressId = addressId;
      } else {
        payload.newAddress = {
          ...newAddress,
          altMobile: newAddress.altMobile || undefined,
          line2: newAddress.line2 || undefined,
          landmark: newAddress.landmark || undefined,
          stateId: newAddress.stateId || undefined,
        };
      }

      // The buyer has chosen how to pay and submitted — Meta "AddPaymentInfo".
      trackAddPaymentInfo(metaCart);
      const result = await placeOrderAction(payload);
      if (!result.ok) {
        setError(result.error);
        // This idempotency key is now spent (server marked it FAILED) —
        // mint a fresh one so simply fixing the issue and clicking Place
        // Order again works, instead of the retry hitting a dead "that
        // attempt failed earlier" wall.
        setIdempotencyKey(freshIdempotencyKey());
        return;
      }

      try {
        sessionStorage.removeItem(GUEST_ADDRESS_KEY);
        sessionStorage.removeItem(GUEST_WELCOME_KEY);
      } catch {
        /* ignore */
      }

      if (!result.razorpayOrder) {
        router.push(`/orders/${result.checkoutGroupId}?placed=1`);
        return;
      }

      // Real online payment — the order/items/charges already exist
      // (PENDING_PAYMENT), but nothing is confirmed until the customer
      // actually pays on the widget and verifyRazorpayPaymentAction
      // confirms it (or the payment.captured webhook does, whichever
      // arrives first).
      const { orderId, amountPaise, keyId, paymentId } = result.razorpayOrder;
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        setError("Couldn't load the payment window. Check your connection and try again.");
        return;
      }
      const selectedAddress = addresses.find((a) => a.id === addressId);
      const razorpay = new window.Razorpay({
        key: keyId,
        amount: amountPaise,
        currency: "INR",
        order_id: orderId,
        name: "Kisan4U",
        prefill: {
          name: selectedAddress?.fullName ?? (newAddress.fullName || undefined),
          contact: newAddress.mobile || undefined,
        },
        handler: (response) => {
          startTransition(async () => {
            const verify = await verifyRazorpayPaymentAction({
              paymentId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            if (!verify.ok) {
              setError(
                `Payment received but couldn't be confirmed automatically (${verify.error}). It will complete shortly — check your order status.`,
              );
            }
            router.push(`/orders/${result.checkoutGroupId}?placed=1`);
          });
        },
        modal: {
          // Customer closed the widget without paying — nothing was ever
          // collected, so the order this checkout created is cancelled
          // outright rather than left sitting as a visible "Pending" order
          // with no payment behind it. abandonCheckoutAction is a safe
          // no-op if the payment actually succeeded in the same instant
          // (the success handler above already fired, or the webhook won
          // the race) — it only ever cancels a Payment still exactly
          // PENDING/uncaptured.
          ondismiss: () => {
            startTransition(async () => {
              await abandonCheckoutAction(result.checkoutGroupId);
              // abandonCheckoutAction puts the items back in the cart, so
              // the buyer can just retry — refresh so the cart count in
              // the nav updates immediately.
              router.refresh();
              setError(
                "Payment wasn't completed, so the order wasn't placed — nothing was charged. Your cart is exactly as you left it; you can try again.",
              );
            });
          },
        },
      });
      razorpay.open();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {welcomeBanner === "existing" && (
        <AlertBox tone="success">
          You&apos;re already a registered customer — we&apos;ve signed you in and filled in your
          saved details below. Your cart is exactly as you left it.
        </AlertBox>
      )}
      {welcomeBanner === "new" && (
        <AlertBox tone="success">
          Your mobile number is verified and your Kisan4U account is ready. Finish your address
          below to place the order.
        </AlertBox>
      )}

      {isGuest && (
        <AlertBox tone="info">
          You&apos;re checking out as a guest. Enter your mobile number below and verify it with a
          one-time code — that signs you in (or creates your account) without losing anything in
          your cart.
        </AlertBox>
      )}

      {referredCustomers && referredCustomers.length > 0 && (
        <Card className="p-5 sm:p-6">
          <SectionHeader title="Order for" />
          <OrderForPicker
            customers={referredCustomers}
            value={orderForId}
            onChange={setOrderForId}
          />
          {isForReferee && (
            <p className="mt-2.5 text-xs text-gray-500">
              You&apos;re placing this order on behalf of <strong>{selectedReferee!.name}</strong>.
              It&apos;s Cash on Delivery only, and {selectedReferee!.name} must approve it before
              it becomes a real order.
            </p>
          )}
        </Card>
      )}

      <Card className="p-5 sm:p-6">
        <SectionHeader
          title={isForReferee ? `Delivery Address — ${selectedReferee!.name}` : "Delivery Address"}
        />
        <div className="flex flex-col gap-2.5">
          {effectiveAddresses.map((a) => (
            <label
              key={a.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border-[1.5px] p-3.5 text-sm ${
                addressMode === "existing" && addressId === a.id
                  ? "border-green-600 bg-green-50"
                  : "border-border"
              }`}
            >
              <input
                type="radio"
                name="address"
                className="mt-0.5"
                checked={addressMode === "existing" && addressId === a.id}
                onChange={() => {
                  setAddressMode("existing");
                  setAddressId(a.id);
                }}
              />
              <span>
                <span className="font-bold text-ink">{a.fullName}</span> — {a.line1}, {a.cityTown},{" "}
                {a.state} - {a.pincode}
                {a.isDefault && (
                  <span className="ml-1.5 text-xs font-semibold text-green-700">(default)</span>
                )}
              </span>
            </label>
          ))}
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-lg border-[1.5px] p-3.5 text-sm font-semibold ${
              addressMode === "new" ? "border-green-600 bg-green-50" : "border-border"
            }`}
          >
            <input
              type="radio"
              name="address"
              checked={addressMode === "new"}
              onChange={() => setAddressMode("new")}
            />
            Use a new address
          </label>
        </div>

        {addressMode === "new" && (
          <div className="mt-4 grid grid-cols-1 gap-4 border-l-2 border-green-100 pl-4 sm:grid-cols-2">
            <FormInput
              label="Full name"
              value={newAddress.fullName}
              onChange={(e) => setNewAddressField("fullName", e.target.value)}
              required
            />
            {isGuest ? (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <FormInput
                      label="Mobile number"
                      type="tel"
                      inputMode="numeric"
                      value={newAddress.mobile}
                      onChange={(e) => setNewAddressField("mobile", e.target.value)}
                      readOnly={otpStage !== "idle"}
                      disabled={otpStage !== "idle"}
                      required
                    />
                  </div>
                  {otpStage === "idle" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={handleRequestGuestOtp}
                      disabled={otpPending || !isValidIndianMobileLocal(newAddress.mobile.trim())}
                    >
                      {otpPending ? "Sending…" : "Verify"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      onClick={() => {
                        setOtpStage("idle");
                        setOtpCode("");
                        setOtpError(null);
                        setIsDealerFlow(false);
                        otpTimers.stop();
                        resetOtpFailures();
                      }}
                      disabled={otpPending}
                    >
                      Change
                    </Button>
                  )}
                </div>

                {otpStage === "dealer-confirm" && (
                  <div className="flex flex-col gap-2.5 rounded-lg border-[1.5px] border-amber-200 bg-amber-50 p-3.5">
                    <p className="text-sm text-ink">
                      <strong>{otpPhone}</strong> belongs to a registered dealer account. Continuing
                      will verify you as that dealer and <strong>erase the cart you have here</strong>
                      . Do you want to continue?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={handleConfirmDealerCheckout}
                        disabled={otpPending}
                      >
                        {otpPending ? "Sending…" : "Yes, continue"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        onClick={handleDeclineDealerCheckout}
                        disabled={otpPending}
                      >
                        No, use a different number
                      </Button>
                    </div>
                  </div>
                )}

                {(otpStage === "sent" || otpStage === "signing") && (
                  <div className="flex flex-col gap-2 rounded-lg border-[1.5px] border-green-100 bg-green-50/60 p-3.5">
                    {isDealerFlow && (
                      <p className="text-xs font-semibold text-amber-700">
                        Verifying as a dealer — your guest cart will be erased once confirmed.
                      </p>
                    )}
                    {otpTimers.expired ? (
                      <OtpExpiredNotice />
                    ) : (
                      <label className="text-xs font-semibold text-gray-600">
                        Enter the 6-digit code sent to {otpPhone}
                      </label>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="******"
                        disabled={otpTimers.expired}
                        className="w-40 rounded-lg border-[1.5px] border-border px-3 py-2.5 text-center text-lg tracking-[6px] outline-none focus:border-green-600 disabled:bg-gray-50 disabled:opacity-60"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={handleConfirmGuestOtp}
                        disabled={otpPending || otpTimers.expired || otpCode.length !== 6}
                      >
                        {otpStage === "signing" || otpPending ? "Verifying…" : "Confirm"}
                      </Button>
                      <OtpResendButton
                        resendIn={otpTimers.resendIn}
                        onResend={isDealerFlow ? handleConfirmDealerCheckout : handleRequestGuestOtp}
                        pending={otpPending}
                      />
                    </div>
                  </div>
                )}

                {otpError && <p className="text-xs font-medium text-danger">{otpError}</p>}
              </div>
            ) : (
              <FormInput
                label="Mobile number"
                value={newAddress.mobile}
                onChange={(e) => setNewAddressField("mobile", e.target.value)}
                required
              />
            )}
            <FormInput
              label="Address line 1"
              className="sm:col-span-2"
              value={newAddress.line1}
              onChange={(e) => setNewAddressField("line1", e.target.value)}
              required
            />
            <FormInput
              label="Village, town or city"
              value={newAddress.cityTown}
              onChange={(e) => setNewAddressField("cityTown", e.target.value)}
              required
            />
            <FormInput
              label="District"
              value={newAddress.district}
              onChange={(e) => setNewAddressField("district", e.target.value)}
              required
            />
            {dealerLockedState ? (
              <FormInput label="State" value={dealerLockedState.name} readOnly disabled />
            ) : (
              <FormSelect
                label="State"
                value={newAddress.stateId}
                onChange={(e) => {
                  const s = states.find((state) => state.id === e.target.value);
                  setNewAddressField("stateId", s?.id ?? "");
                  setNewAddressField("state", s?.name ?? "");
                }}
                required
              >
                <option value="">— Select a state —</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </FormSelect>
            )}
            <FormInput
              label="PIN code"
              value={newAddress.pincode}
              onChange={(e) => setNewAddressField("pincode", e.target.value)}
              required
            />
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeader title="Delivery Method" />
        {role === "CUSTOMER" ? (
          // A customer only ever has one valid delivery method — no selector is
          // shown at all (requirement: "do not show delivery-method selection
          // when there is only one valid option"), just a clear statement of
          // what will happen.
          <AlertBox tone="info">
            <strong>Kisan4U Courier</strong> — delivery charges are paid by the seller, not you.
          </AlertBox>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-gray-600">
            <div>
              Delivery method:{" "}
              <strong className="text-ink">
                {deliveryMethod === "KISAN4U_COURIER" ? "Kisan4U Courier" : "Transport"}
              </strong>{" "}
              —{" "}
              <a
                href={`/checkout?delivery=${deliveryMethod === "KISAN4U_COURIER" ? "TRANSPORT" : "KISAN4U_COURIER"}`}
                className="font-semibold text-earth-700 hover:underline"
              >
                change
              </a>
            </div>
            <p>
              Dealer product prices always exclude transportation — the transportation charge above
              is added to your payable amount and collected from you; the collection charge is
              always borne by the seller and is never added to what you pay.
            </p>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeader title="Payment Method" />
        {isForReferee ? (
          // Proposed orders on a referee's behalf are COD-only, enforced
          // server-side in createProposedOrder — no other option is even
          // offered here.
          <div className="flex cursor-default items-center gap-3 rounded-lg border-[1.5px] border-green-600 bg-green-50 p-3.5 text-sm font-semibold">
            <input type="radio" checked readOnly />
            {PAYMENT_LABEL.COD}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {allowedPaymentMethods.map((method) => {
              // Shown to customers only — the rate comes from the same table
              // the server applies (getCustomerPromoDiscountPercent), so the
              // wording can never drift from what's actually discounted.
              const offerPercent = getCustomerPromoDiscountPercent(
                role,
                method as PromoPaymentMethod,
              );
              const offerText =
                offerPercent > 0
                  ? method === "ONLINE_PARTIAL"
                    ? `Get ${offerPercent}% off by paying partially now`
                    : method === "ONLINE_FULL"
                      ? `Get ${offerPercent}% off by paying full amount now`
                      : null
                  : null;
              return (
                <label
                  key={method}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border-[1.5px] p-3.5 text-sm font-semibold ${
                    paymentMethod === method ? "border-green-600 bg-green-50" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === method}
                    onChange={() => setPaymentMethod(method)}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span>{PAYMENT_LABEL[method] ?? method}</span>
                    {offerText && (
                      <span className="text-xs font-bold text-success">{offerText}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {!isForReferee && walletBalance > 0 && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border p-3.5 text-sm">
            <div className="flex justify-between">
              <span>Kisan4U Wallet balance</span>
              <span className="font-semibold text-ink">₹{walletBalance.toFixed(2)}</span>
            </div>
            <FormInput
              label="Apply wallet amount (optional)"
              type="number"
              min={0}
              max={walletEligibleCap}
              step="0.01"
              value={walletAmountInput || ""}
              onChange={(e) => setWalletAmountInput(Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="text-xs text-gray-500">
              Up to ₹{walletEligibleCap.toFixed(2)} can be applied — it&apos;s deducted from the
              order total first and from your wallet immediately;{" "}
              {paymentMethod === "COD"
                ? "only the rest is collected in cash on delivery."
                : paymentMethod === "ONLINE_PARTIAL"
                  ? "the partial-payment split then applies to what is left."
                  : "only the rest is paid online."}
            </p>
          </div>
        )}

        <div className="mt-4">
          <SectionHeader title="Coupon" />
          {appliedCoupon ? (
            <div className="flex items-center justify-between rounded-lg border-[1.5px] border-green-600 bg-green-50 p-3 text-sm font-semibold">
              <span>
                {appliedCoupon.code}
                <span className="ml-2 font-normal text-success">
                  −₹{appliedCoupon.totalDiscount.toFixed(2)} applied
                </span>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handleRemoveCoupon}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <FormInput
                label=""
                value={couponCodeInput}
                onChange={(e) => setCouponCodeInput(e.target.value)}
                placeholder="Enter coupon code"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!couponCodeInput.trim() || isCouponPending}
                onClick={handleApplyCoupon}
              >
                {isCouponPending ? "Checking…" : "Apply"}
              </Button>
            </div>
          )}
          {couponError && <p className="mt-1 text-xs font-semibold text-danger">{couponError}</p>}
        </div>

        <div className="mt-4 rounded-xl border border-green-100 bg-gradient-to-b from-green-50/70 to-white p-4 sm:p-5">
          <div className="mb-2.5 text-xs font-bold uppercase tracking-wide text-green-800">
            Price Summary
          </div>
          <dl className="flex flex-col gap-1.5 text-sm text-gray-700">
            <div className="flex justify-between">
              <dt>Selling price</dt>
              <dd className="text-ink">₹{sellingPriceTotal.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Tax</dt>
              <dd className="text-ink">₹{taxTotal.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Delivery charge</dt>
              <dd className="text-ink">
                {deliveryChargeTotal > 0 ? (
                  `₹${deliveryChargeTotal.toFixed(2)}`
                ) : (
                  <span className="text-gray-500">Paid by seller</span>
                )}
              </dd>
            </div>
            {discountAmount > 0 && discountLabel && (
              <div className="flex justify-between font-semibold text-success">
                <dt>{discountLabel}</dt>
                <dd>−₹{discountAmount.toFixed(2)}</dd>
              </div>
            )}
            {appliedCoupon && (
              <div className="flex justify-between font-semibold text-success">
                <dt>Coupon ({appliedCoupon.code})</dt>
                <dd>−₹{appliedCoupon.totalDiscount.toFixed(2)}</dd>
              </div>
            )}
            {walletApplied > 0 && (
              <div className="flex justify-between font-semibold text-success">
                <dt>Wallet applied</dt>
                <dd>−₹{walletApplied.toFixed(2)}</dd>
              </div>
            )}
          </dl>

          <div className="mt-2.5 flex items-center justify-between border-t border-green-200 pt-2.5 text-base font-extrabold text-ink">
            <span>Total amount</span>
            <span>₹{netTotal.toFixed(2)}</span>
          </div>

          {/* Wallet first (off the whole total), then whatever the selected
              method makes of the rest. */}
          <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {walletApplied > 0 && (
              <PaymentSplitTile
                label="Wallet payment"
                sub="Deducted from your Kisan4U Wallet now"
                amount={walletApplied}
                tone="blue"
              />
            )}
            {paymentMethod === "ONLINE_PARTIAL" && livePartialPreview ? (
              <>
                <PaymentSplitTile
                  label="Partial payment"
                  sub={`Pay now online${livePartialPreview.ruleLabel ? ` · ${livePartialPreview.ruleLabel}` : ""}`}
                  amount={livePartialPreview.advanceAmount}
                  tone="blue"
                />
                <PaymentSplitTile
                  label="COD payment"
                  sub="Pay in cash on delivery"
                  amount={livePartialPreview.remainingAmount}
                  tone="amber"
                />
              </>
            ) : paymentMethod === "COD" ? (
              payableAfterWallet > 0 && (
                <PaymentSplitTile
                  label="COD payment"
                  sub="Pay in cash on delivery"
                  amount={payableAfterWallet}
                  tone="amber"
                />
              )
            ) : (
              payableAfterWallet > 0 && (
                <PaymentSplitTile
                  label="Pay now online"
                  sub={walletApplied > 0 ? "Rest of the amount, paid online" : "Full amount, paid online"}
                  amount={payableAfterWallet}
                  tone="blue"
                />
              )
            )}
          </div>
        </div>

        {deliveryMethod === "TRANSPORT" && (
          <div className="mt-4">
            <FormTextarea
              label="Transport note / preference"
              value={transportNote}
              onChange={(e) => setTransportNote(e.target.value)}
              maxLength={300}
              rows={3}
              required
            />
          </div>
        )}
      </Card>

      {error && <AlertBox tone="danger">{error}</AlertBox>}
      {isGuest && (
        <AlertBox tone="warning">
          Verify your mobile number in the Delivery Address section above to place your order.
        </AlertBox>
      )}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={isPending || !paymentMethod || isGuest}
        fullWidth
      >
        {isPending
          ? isForReferee
            ? "Sending…"
            : "Placing order…"
          : isGuest
            ? "Verify your number to continue"
            : isForReferee
              ? "Send order for approval"
              : "Place Order"}
      </Button>
    </form>
  );
}

/**
 * Small local searchable "Order for" combobox — click/focus to open, type
 * to filter by name. Not promoted to @kisan4u/ui since the option list is
 * tiny (a BA's own referred customers, max 200) and this is the only place
 * it's used.
 */
function OrderForPicker({
  customers,
  value,
  onChange,
}: {
  customers: ReferredCustomer[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => [{ id: "", name: "Myself" }, ...customers.map((c) => ({ id: c.id, name: c.name }))],
    [customers],
  );
  const selected = options.find((o) => o.id === value) ?? { id: "", name: "Myself" };
  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={open ? query : selected.name}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder="Search a referred customer…"
        className="w-full rounded-lg border-[1.5px] border-border px-3 py-2.5 text-sm outline-none focus:border-green-600"
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-white text-sm shadow-lg">
          {filtered.length === 0 && <li className="px-3 py-2 text-gray-500">No match</li>}
          {filtered.map((o) => (
            <li key={o.id || "self"}>
              <button
                type="button"
                className={`block w-full px-3 py-2 text-left hover:bg-green-50 ${
                  o.id === value ? "bg-green-50 font-semibold" : ""
                }`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SPLIT_TILE_TONE = {
  blue: "border-info/30 bg-info-bg text-info",
  amber: "border-warning/30 bg-warning-bg text-warning",
} as const;

/** One "how much, when" tile in the checkout Price Summary — Partial payment / COD payment / Pay now online. Kept visually distinct (colour + icon-free label) from the plain summary rows above so a buyer can't mistake "what this order costs" for "what's due right now". */
function PaymentSplitTile({
  label,
  sub,
  amount,
  tone,
}: {
  label: string;
  sub: string;
  amount: number;
  tone: "blue" | "amber";
}) {
  return (
    <div className={`rounded-lg border p-3 ${SPLIT_TILE_TONE[tone]}`}>
      <div className="text-xs font-bold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold">₹{amount.toFixed(2)}</div>
      <div className="mt-0.5 text-xs opacity-80">{sub}</div>
    </div>
  );
}
