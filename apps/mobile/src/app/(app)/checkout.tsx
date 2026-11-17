import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { computeWalletSplit, getCustomerPromoDiscountPercent } from "@kisan4u/validators";
import {
  AppText,
  Badge,
  Button,
  ErrorState,
  Screen,
  SelectField,
  TextField,
} from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/context/auth-context";
import { useCart } from "@/context/cart-context";
import { getAddresses } from "@/lib/api/addresses";
import { getCart, removeCartItem } from "@/lib/api/cart";
import {
  abandonCheckout,
  getCheckoutPreview,
  newIdempotencyKey,
  placeOrder,
  verifyRazorpayPayment,
  type CheckoutInput,
  type CheckoutPreview,
  type PaymentMethod,
} from "@/lib/api/checkout";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { GuestVerifyGate } from "@/components/checkout/GuestVerifyGate";
import { useToast } from "@/context/toast-context";
import { useT } from "@/context/language-context";
import { PAYMENT_METHOD_LABEL } from "@/lib/order-status-labels";
import { Radius, Spacing } from "@/constants/theme";
import type { AddressDTO, CartDTO } from "@/lib/api/types";
import {
  createProposedOrder,
  getBaDashboard,
  getBaReferredCustomers,
  type BaReferredCustomer,
} from "@/lib/api/ba";
import { getStates, type IndianStateDTO } from "@/lib/api/states";

function formatRupees(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const CHECKOUT_PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  COD: "Cash on delivery",
  ONLINE_FULL: "Pay the full amount online now",
  ONLINE_PARTIAL: "Pay part online now, rest on delivery",
  WALLET: "Kisan4U Wallet",
  TRANSPORT_FULL_ONLINE: "Pay the full amount online now",
};

/** Sentinel option value for the "Order for" picker's own row, since SelectField's `value` is a plain string. */
const SELF_OPTION = "__self__";

type RefereeAddressForm = {
  fullName: string;
  mobile: string;
  line1: string;
  line2: string;
  landmark: string;
  cityTown: string;
  district: string;
  state: string;
  stateId: string | null;
  pincode: string;
};

function emptyRefereeAddress(): RefereeAddressForm {
  return {
    fullName: "",
    mobile: "",
    line1: "",
    line2: "",
    landmark: "",
    cityTown: "",
    district: "",
    state: "",
    stateId: null,
    pincode: "",
  };
}

function isAddressComplete(address: RefereeAddressForm) {
  return Boolean(
    address.fullName.trim() &&
    /^\d{10}$/.test(address.mobile.trim()) &&
    address.line1.trim() &&
    address.cityTown.trim() &&
    address.district.trim() &&
    address.stateId &&
    /^\d{6}$/.test(address.pincode.trim()),
  );
}

export default function CheckoutScreen() {
  const { user, isGuest } = useAuth();
  const theme = useTheme();
  const toast = useToast();
  const t = useT();
  const { refresh: refreshCart } = useCart();
  const isDealer = user?.role === "DEALER";
  const [guestCheckout] = useState(isGuest);

  const [cart, setCart] = useState<CartDTO | null>(null);
  const [addresses, setAddresses] = useState<AddressDTO[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"KISAN4U_COURIER" | "TRANSPORT">(
    "KISAN4U_COURIER",
  );
  const [transportNote, setTransportNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [walletAmountInput, setWalletAmountInput] = useState("");
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponApplying, setCouponApplying] = useState(false);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey());
  const [guestAddress, setGuestAddress] = useState<RefereeAddressForm>(emptyRefereeAddress());
  const [guestStates, setGuestStates] = useState<IndianStateDTO[]>([]);

  // BA "order for a referee" — an approved BA with at least one referred
  // customer gets an "Order for" picker up top; everyone else never sees
  // this and the rest of the screen behaves exactly as before.
  const [referredCustomers, setReferredCustomers] = useState<BaReferredCustomer[]>([]);
  const [refereeId, setRefereeId] = useState<string | null>(null); // null = Myself
  const [refereeAddressId, setRefereeAddressId] = useState<string | null>(null);
  const [refereeNewAddressMode, setRefereeNewAddressMode] = useState(false);
  const [refereeAddress, setRefereeAddress] = useState<RefereeAddressForm>(emptyRefereeAddress());
  const [refereeStates, setRefereeStates] = useState<IndianStateDTO[]>([]);
  const referee = referredCustomers.find((c) => c.id === refereeId) ?? null;

  useEffect(() => {
    if (isGuest || guestCheckout) return;
    (async () => {
      const dash = await getBaDashboard();
      if (!dash.ok || !dash.data.enabled || !dash.data.profile) return;
      const fs = dash.data.profile.frontendStatus;
      if (fs !== "APPROVED" && fs !== "APPROVED_NO_BANK") return;
      const custRes = await getBaReferredCustomers();
      if (custRes.ok) setReferredCustomers(custRes.data.customers);
    })();
  }, [isGuest, guestCheckout, user?.id]);

  // Default the referee's address section to a saved address if they have
  // one, otherwise straight into the "add a new address" form.
  useEffect(() => {
    if (!refereeId) return;
    const c = referredCustomers.find((x) => x.id === refereeId);
    setRefereeAddress(emptyRefereeAddress());
    if (c && c.addresses.length > 0) {
      setRefereeAddressId(c.addresses[0]?.id ?? null);
      setRefereeNewAddressMode(false);
    } else {
      setRefereeAddressId(null);
      setRefereeNewAddressMode(true);
    }
  }, [refereeId, referredCustomers]);

  // Indian states, for the referee's "new address" state picker — fetched
  // lazily, only once that form is actually shown.
  useEffect(() => {
    if (!refereeNewAddressMode || refereeStates.length > 0) return;
    getStates().then((res) => {
      if (res.ok) setRefereeStates(res.data.states);
    });
  }, [refereeNewAddressMode, refereeStates.length]);

  useEffect(() => {
    if (!guestCheckout || guestStates.length > 0) return;
    getStates().then((res) => {
      if (res.ok) setGuestStates(res.data.states);
    });
  }, [guestCheckout, guestStates.length]);

  // Keyed on user id so the cart reloads after guest verification claims it
  // onto the real customer. Checkouts that began as a guest keep using the
  // inline address instead of switching to the account address book.
  useEffect(() => {
    (async () => {
      setError(null);
      const cartResult = await getCart();
      if (!cartResult.ok) return setError(cartResult.error.message);
      setCart(cartResult.data);
      if (isGuest || guestCheckout) {
        setAddresses([]);
        setAddressId(null);
        return;
      }
      const addressResult = await getAddresses();
      if (!addressResult.ok) return setError(addressResult.error.message);
      setAddresses(addressResult.data.addresses);
      const def =
        addressResult.data.addresses.find((a) => a.isDefault) ?? addressResult.data.addresses[0];
      if (def) setAddressId(def.id);
    })();
  }, [user?.id, isGuest, guestCheckout]);

  const loadPreview = useCallback(
    async (delivery: "KISAN4U_COURIER" | "TRANSPORT", couponCode?: string) => {
      setPreviewLoading(true);
      setPreviewError(null);
      const result = await getCheckoutPreview(delivery, couponCode);
      setPreviewLoading(false);
      if (!result.ok) {
        setPreview(null);
        setPreviewError(result.error.message);
        return;
      }
      setPreview(result.data);
      // Server is the only source of truth for which payment methods are
      // valid for this role + delivery method (packages/orders/src/payment-
      // rules.ts) — the client never hard-codes this list.
      setPaymentMethod((prev) =>
        prev && result.data.allowedPaymentMethods.includes(prev)
          ? prev
          : (result.data.allowedPaymentMethods[0] ?? null),
      );
    },
    [],
  );

  useEffect(() => {
    loadPreview(deliveryMethod, appliedCouponCode ?? undefined);
  }, [deliveryMethod, appliedCouponCode, loadPreview]);

  async function handleApplyCoupon() {
    const code = couponCodeInput.trim().toUpperCase();
    if (!code) return;
    setCouponApplying(true);
    setCouponError(null);
    const result = await getCheckoutPreview(deliveryMethod, code);
    setCouponApplying(false);
    if (!result.ok) {
      setCouponError(result.error.message);
      return;
    }
    const applied = Object.values(result.data.methods).find(
      (method) => method?.appliedCoupon,
    )?.appliedCoupon;
    if (!applied) {
      setCouponError("This coupon doesn't apply to your cart.");
      return;
    }
    setPreview(result.data);
    setAppliedCouponCode(applied.code);
    setCouponCodeInput("");
  }

  function handleRemoveCoupon() {
    setCouponError(null);
    setAppliedCouponCode(null);
    setCouponCodeInput("");
  }

  /** BA sending the current cart as a proposed COD order for a referee, instead of checking out for themselves. */
  async function handleSendProposedOrder() {
    if (!refereeId || !cart) return;
    if (refereeNewAddressMode) {
      if (
        !refereeAddress.fullName.trim() ||
        !refereeAddress.mobile.trim() ||
        !refereeAddress.line1.trim() ||
        !refereeAddress.cityTown.trim() ||
        !refereeAddress.district.trim() ||
        !refereeAddress.stateId ||
        !refereeAddress.pincode.trim()
      ) {
        setError("Fill in the customer's delivery address.");
        return;
      }
    } else if (!refereeAddressId) {
      setError("Select a delivery address for this customer.");
      return;
    }

    const lines = cart.sellerGroups.flatMap((g) =>
      g.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.quantity,
      })),
    );
    if (lines.length === 0) {
      setError("Your cart is empty.");
      return;
    }

    setPlacing(true);
    setError(null);
    const result = await createProposedOrder({
      refereeUserId: refereeId,
      ...(refereeNewAddressMode
        ? {
            address: {
              fullName: refereeAddress.fullName.trim(),
              mobile: refereeAddress.mobile.trim(),
              line1: refereeAddress.line1.trim(),
              line2: refereeAddress.line2.trim() || undefined,
              landmark: refereeAddress.landmark.trim() || undefined,
              cityTown: refereeAddress.cityTown.trim(),
              district: refereeAddress.district.trim(),
              state: refereeAddress.state,
              stateId: refereeAddress.stateId!,
              pincode: refereeAddress.pincode.trim(),
            },
          }
        : { savedAddressId: refereeAddressId! }),
      lines,
    });
    if (!result.ok) {
      setPlacing(false);
      setError(result.error.message);
      return;
    }

    // createProposedOrder never touches the BA's own cart (only the
    // referee's, and only on approve/customize) — clear the items we just
    // proposed ourselves so the cart ends up empty, same as a normal
    // successful checkout.
    await Promise.all(
      cart.sellerGroups.flatMap((g) => g.items.map((i) => removeCartItem(i.cartItemId))),
    ).catch(() => {});
    setPlacing(false);
    await refreshCart().catch(() => {});
    toast.success("Order sent for the customer's approval");
    router.replace("/(app)/more/business-associate" as never);
  }

  async function handlePlaceOrder() {
    if (refereeId) return handleSendProposedOrder();
    if (isGuest) {
      setError(t("checkout.verifyToContinue"));
      return;
    }
    if (guestCheckout && !isAddressComplete(guestAddress)) {
      setError(t("checkout.completeAddress"));
      return;
    }
    if (!guestCheckout && !addressId) {
      setError("Select a delivery address.");
      return;
    }
    if (!paymentMethod) {
      setError("Select a payment method.");
      return;
    }
    if (deliveryMethod === "TRANSPORT" && !transportNote.trim()) {
      setError("Transport note is required for Transport orders.");
      return;
    }
    setPlacing(true);
    setError(null);
    const input: CheckoutInput = {
      ...(guestCheckout
        ? {
            newAddress: {
              fullName: guestAddress.fullName.trim(),
              mobile: guestAddress.mobile.trim(),
              line1: guestAddress.line1.trim(),
              line2: guestAddress.line2.trim() || undefined,
              landmark: guestAddress.landmark.trim() || undefined,
              cityTown: guestAddress.cityTown.trim(),
              district: guestAddress.district.trim(),
              state: guestAddress.state,
              stateId: guestAddress.stateId,
              pincode: guestAddress.pincode.trim(),
              addressType: "HOME",
              isDefault: false,
            },
          }
        : { addressId: addressId! }),
      deliveryMethod,
      paymentMethod,
      idempotencyKey,
      ...(deliveryMethod === "TRANSPORT" ? { transportNote: transportNote.trim() } : {}),
      ...(walletApplied > 0 ? { walletAmountApplied: walletApplied } : {}),
      ...(appliedCouponCode ? { couponCode: appliedCouponCode } : {}),
    };
    const result = await placeOrder(input);
    if (!result.ok) {
      setPlacing(false);
      setError(result.error.message);
      return;
    }

    const { razorpayOrder, checkoutGroupId, groupNumber } = result.data;

    // COD / fully wallet-covered — the order is already confirmed server-side.
    if (!razorpayOrder) {
      setPlacing(false);
      await refreshCart().catch(() => {});
      router.replace("/(app)/(tabs)/orders");
      return;
    }

    // Online payment: the SellerOrder rows exist but are unpaid until the
    // Razorpay sheet completes. Mirrors the web checkout-form flow.
    const selectedAddr = addresses.find((a) => a.id === addressId);
    const pay = await openRazorpayCheckout({
      keyId: razorpayOrder.keyId,
      orderId: razorpayOrder.orderId,
      amountPaise: razorpayOrder.amountPaise,
      name: "Kisan4U",
      description: `Order ${groupNumber}`,
      prefillContact: guestCheckout ? guestAddress.mobile : selectedAddr?.mobile,
      prefillName:
        (guestCheckout ? guestAddress.fullName : selectedAddr?.fullName) ||
        [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
        undefined,
      themeColor: theme.green700,
    });

    if (pay.ok) {
      const verified = await verifyRazorpayPayment({
        paymentId: razorpayOrder.paymentId,
        razorpayOrderId: pay.data.razorpay_order_id,
        razorpayPaymentId: pay.data.razorpay_payment_id,
        razorpaySignature: pay.data.razorpay_signature,
      });
      setPlacing(false);
      await refreshCart().catch(() => {});
      if (verified.ok) toast.success("Payment successful");
      else {
        // Razorpay captured it but our confirm call failed — the webhook
        // is the backstop; still take them to the order.
        toast.show("Payment received — confirmation may take a moment");
      }
      router.replace("/(app)/(tabs)/orders");
      return;
    }

    // Sheet dismissed / payment failed — release the un-captured order.
    // abandonCheckout puts the items back in the cart, so refresh the
    // badge and let the buyer retry.
    await abandonCheckout(checkoutGroupId);
    await refreshCart().catch(() => {});
    setPlacing(false);
    setError(
      pay.cancelled
        ? "Payment cancelled — nothing was charged. Your cart is exactly as you left it."
        : `Payment failed: ${pay.message}. Your cart is intact — you can try again.`,
    );
  }

  if (error && !cart) return <ErrorState message={error} />;
  if (!cart) return null;

  // Ordering for a referee is always COD (the referee decides payment
  // themselves when they approve) — this never touches the `paymentMethod`
  // state itself, so switching back to "Myself" restores exactly what was
  // selected before.
  const activePaymentMethod: PaymentMethod | null = refereeId ? "COD" : paymentMethod;

  const methodBreakdown = activePaymentMethod ? preview?.methods[activePaymentMethod] : undefined;
  const sellingPriceSubtotal = preview ? preview.sellers.reduce((t, s) => t + s.subtotal, 0) : 0;
  const taxTotal = preview ? preview.sellers.reduce((t, s) => t + s.taxAmount, 0) : 0;
  const deliveryTotal = preview
    ? preview.sellers.reduce((t, s) => t + s.customerPayableDelivery, 0)
    : 0;

  // The wallet is applied LAST, after every discount (promo, prepaid/partial,
  // coupon) that is already inside grandTotal — checkout() in packages/orders
  // splits it the same way (both use computeWalletSplit). COD / full prepaid:
  // it comes off the whole total. Partial prepaid: the advance is worked out
  // on the full total and never reduced; the wallet only comes off the COD
  // remainder. An order for a referee never uses the buyer's wallet.
  const grandTotal = methodBreakdown?.grandTotal ?? 0;
  const partialAdvance =
    activePaymentMethod === "ONLINE_PARTIAL" ? (methodBreakdown?.advance ?? null) : null;
  const split = computeWalletSplit({
    kind: partialAdvance ? "PARTIAL" : activePaymentMethod === "COD" ? "COD" : "PREPAID",
    grandTotal,
    advanceAmount: partialAdvance?.advanceAmount,
    walletBalance: refereeId ? 0 : (preview?.walletBalance ?? 0),
    walletRequested: Number(walletAmountInput) || 0,
  });
  const { walletEligibleCap, walletApplied } = split;
  const walletSubtitle = partialAdvance
    ? "Deducted now, from the cash-on-delivery balance"
    : "Deducted from your Kisan4U Wallet now";

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {guestCheckout ? (
          <View
            style={[
              styles.guestBanner,
              { backgroundColor: theme.green50, borderColor: theme.green100 },
            ]}
          >
            <AppText variant="bodyBold" color="green">
              {t("checkout.guestBannerTitle")}
            </AppText>
            <AppText variant="caption" color="secondary">
              {t("checkout.guestBannerBody")}
            </AppText>
          </View>
        ) : null}

        {referredCustomers.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="subtitle">Order for</AppText>
            <SelectField
              value={refereeId ?? SELF_OPTION}
              options={[
                { label: "Myself", value: SELF_OPTION },
                ...referredCustomers.map((c) => ({ label: c.name, value: c.id })),
              ]}
              onChange={(v) => setRefereeId(v === SELF_OPTION ? null : v)}
            />
            {referee ? (
              <AppText variant="caption" color="secondary">
                This order will be sent to {referee.name} for their approval, rejection, or
                customization — it never charges you.
              </AppText>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <AppText variant="subtitle">Delivery address</AppText>
          {guestCheckout ? (
            <View style={[styles.card, { borderColor: theme.border, gap: Spacing.sm }]}>
              <TextField
                label={t("checkout.fullName")}
                value={guestAddress.fullName}
                onChangeText={(value) =>
                  setGuestAddress((address) => ({ ...address, fullName: value }))
                }
              />
              {isGuest ? (
                <GuestVerifyGate
                  phone={guestAddress.mobile}
                  name={guestAddress.fullName}
                  onChangePhone={(mobile) => setGuestAddress((address) => ({ ...address, mobile }))}
                />
              ) : (
                <>
                  <TextField
                    label={t("checkout.mobileNumber")}
                    value={guestAddress.mobile}
                    keyboardType="phone-pad"
                    editable={false}
                  />
                  <AppText variant="caption" color="success">
                    {t("checkout.mobileVerified")}
                  </AppText>
                </>
              )}
              <TextField
                label={t("checkout.addressLine1")}
                value={guestAddress.line1}
                onChangeText={(value) =>
                  setGuestAddress((address) => ({ ...address, line1: value }))
                }
                multiline
              />
              <TextField
                label={t("checkout.addressLine2")}
                value={guestAddress.line2}
                onChangeText={(value) =>
                  setGuestAddress((address) => ({ ...address, line2: value }))
                }
              />
              <TextField
                label={t("checkout.landmark")}
                value={guestAddress.landmark}
                onChangeText={(value) =>
                  setGuestAddress((address) => ({ ...address, landmark: value }))
                }
              />
              <TextField
                label={t("checkout.cityTown")}
                value={guestAddress.cityTown}
                onChangeText={(value) =>
                  setGuestAddress((address) => ({ ...address, cityTown: value }))
                }
              />
              <TextField
                label={t("checkout.district")}
                value={guestAddress.district}
                onChangeText={(value) =>
                  setGuestAddress((address) => ({ ...address, district: value }))
                }
              />
              <SelectField
                label={t("checkout.state")}
                value={guestAddress.stateId}
                onChange={(value) =>
                  setGuestAddress((address) => ({
                    ...address,
                    stateId: value,
                    state: guestStates.find((state) => state.id === value)?.name ?? address.state,
                  }))
                }
                options={guestStates.map((state) => ({ label: state.name, value: state.id }))}
              />
              <TextField
                label={t("checkout.pincode")}
                keyboardType="number-pad"
                maxLength={6}
                value={guestAddress.pincode}
                onChangeText={(value) =>
                  setGuestAddress((address) => ({
                    ...address,
                    pincode: value.replace(/[^0-9]/g, "").slice(0, 6),
                  }))
                }
              />
            </View>
          ) : referee ? (
            !refereeNewAddressMode && referee.addresses.length > 0 ? (
              <>
                {referee.addresses.map((addr) => (
                  <Pressable
                    key={addr.id}
                    onPress={() => setRefereeAddressId(addr.id)}
                    style={[
                      styles.card,
                      {
                        borderColor: refereeAddressId === addr.id ? theme.green700 : theme.border,
                        backgroundColor:
                          refereeAddressId === addr.id ? theme.green50 : theme.surface,
                      },
                    ]}
                  >
                    <AppText variant="bodyBold">{addr.label}</AppText>
                  </Pressable>
                ))}
                <Button
                  label="Add a new address for this customer"
                  variant="outline"
                  onPress={() => {
                    setRefereeNewAddressMode(true);
                    setRefereeAddressId(null);
                  }}
                />
              </>
            ) : (
              <View style={[styles.card, { borderColor: theme.border, gap: Spacing.sm }]}>
                <AppText variant="bodyBold">New address for {referee.name}</AppText>
                <TextField
                  label="Full name"
                  value={refereeAddress.fullName}
                  onChangeText={(v) => setRefereeAddress((f) => ({ ...f, fullName: v }))}
                />
                <TextField
                  label="Mobile"
                  keyboardType="phone-pad"
                  value={refereeAddress.mobile}
                  onChangeText={(v) => setRefereeAddress((f) => ({ ...f, mobile: v }))}
                />
                <TextField
                  label="Address line 1"
                  value={refereeAddress.line1}
                  onChangeText={(v) => setRefereeAddress((f) => ({ ...f, line1: v }))}
                  multiline
                />
                <TextField
                  label="Address line 2 (optional)"
                  value={refereeAddress.line2}
                  onChangeText={(v) => setRefereeAddress((f) => ({ ...f, line2: v }))}
                />
                <TextField
                  label="Landmark (optional)"
                  value={refereeAddress.landmark}
                  onChangeText={(v) => setRefereeAddress((f) => ({ ...f, landmark: v }))}
                />
                <TextField
                  label="Town / City"
                  value={refereeAddress.cityTown}
                  onChangeText={(v) => setRefereeAddress((f) => ({ ...f, cityTown: v }))}
                />
                <TextField
                  label="District"
                  value={refereeAddress.district}
                  onChangeText={(v) => setRefereeAddress((f) => ({ ...f, district: v }))}
                />
                <SelectField
                  label="State"
                  value={refereeAddress.stateId}
                  onChange={(v) =>
                    setRefereeAddress((f) => ({
                      ...f,
                      stateId: v,
                      state: refereeStates.find((s) => s.id === v)?.name ?? f.state,
                    }))
                  }
                  options={refereeStates.map((s) => ({ label: s.name, value: s.id }))}
                />
                <TextField
                  label="Pincode"
                  keyboardType="number-pad"
                  maxLength={6}
                  value={refereeAddress.pincode}
                  onChangeText={(v) =>
                    setRefereeAddress((f) => ({
                      ...f,
                      pincode: v.replace(/[^0-9]/g, "").slice(0, 6),
                    }))
                  }
                />
                {referee.addresses.length > 0 ? (
                  <Button
                    label="Use a saved address instead"
                    variant="ghost"
                    onPress={() => setRefereeNewAddressMode(false)}
                  />
                ) : null}
              </View>
            )
          ) : addresses.length === 0 ? (
            <Button
              label="Add an address"
              variant="outline"
              onPress={() => router.push("/(app)/addresses")}
            />
          ) : (
            addresses.map((addr) => (
              <Pressable
                key={addr.id}
                onPress={() => setAddressId(addr.id)}
                style={[
                  styles.card,
                  {
                    borderColor: addressId === addr.id ? theme.green700 : theme.border,
                    backgroundColor: addressId === addr.id ? theme.green50 : theme.surface,
                  },
                ]}
              >
                <AppText variant="bodyBold">{addr.fullName}</AppText>
                <AppText variant="caption" color="secondary">
                  {addr.line1}, {addr.cityTown}, {addr.state} - {addr.pincode}
                </AppText>
              </Pressable>
            ))
          )}
        </View>

        {isDealer ? (
          <View style={styles.section}>
            <AppText variant="subtitle">Delivery method</AppText>
            <View style={styles.chipsRow}>
              {(["KISAN4U_COURIER", "TRANSPORT"] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setDeliveryMethod(m)}
                  style={[
                    styles.chip,
                    {
                      borderColor: deliveryMethod === m ? theme.green700 : theme.border,
                      backgroundColor: deliveryMethod === m ? theme.green50 : theme.surface,
                    },
                  ]}
                >
                  <AppText variant="body" color={deliveryMethod === m ? "green" : "ink"}>
                    {m === "KISAN4U_COURIER" ? "Kisan4U Courier" : "My own transport"}
                  </AppText>
                </Pressable>
              ))}
            </View>
            {deliveryMethod === "TRANSPORT" ? (
              <AppText variant="caption" color="secondary">
                Transport orders must be paid in full online — partial payment and Cash on Delivery
                are not available.
              </AppText>
            ) : (
              <AppText variant="caption" color="secondary">
                Kisan4U Courier orders must be paid online (full or partial) — Cash on Delivery is
                not available for dealers.
              </AppText>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <AppText variant="subtitle">Delivery method</AppText>
            <AppText variant="body" color="secondary">
              Kisan4U Courier — delivery charges are paid by the seller, not you.
            </AppText>
          </View>
        )}

        {deliveryMethod === "TRANSPORT" ? (
          <View style={styles.section}>
            <TextField
              label="Transport note / preference"
              placeholder="Transport details, pickup point, or driver contact preference"
              value={transportNote}
              onChangeText={setTransportNote}
              maxLength={300}
              multiline
              error={!transportNote.trim() ? "Required for Transport orders." : undefined}
            />
            <AppText variant="caption" color="secondary">
              {transportNote.length}/300
            </AppText>
          </View>
        ) : null}

        <View style={styles.section}>
          <AppText variant="subtitle">Payment method</AppText>
          {refereeId ? (
            <View
              style={[
                styles.paymentOption,
                { borderColor: theme.green700, backgroundColor: theme.green50 },
              ]}
            >
              <AppText variant="body" color="green">
                Cash on Delivery
              </AppText>
              <AppText variant="caption" color="secondary">
                Orders placed on behalf of a customer are always COD — they can switch to online
                payment themselves when they approve it.
              </AppText>
            </View>
          ) : previewLoading ? (
            <AppText variant="caption" color="secondary">
              Loading payment options…
            </AppText>
          ) : previewError ? (
            <AppText variant="body" color="danger">
              {previewError}
            </AppText>
          ) : (
            <View style={styles.chipsRow}>
              {(preview?.allowedPaymentMethods ?? []).map((m) => {
                const methodInfo = preview?.methods[m];
                return (
                  <Pressable
                    key={m}
                    onPress={() => setPaymentMethod(m)}
                    style={[
                      styles.paymentOption,
                      {
                        borderColor: paymentMethod === m ? theme.green700 : theme.border,
                        backgroundColor: paymentMethod === m ? theme.green50 : theme.surface,
                      },
                    ]}
                  >
                    <AppText variant="body" color={paymentMethod === m ? "green" : "ink"}>
                      {CHECKOUT_PAYMENT_METHOD_LABEL[m] ?? PAYMENT_METHOD_LABEL[m] ?? m}
                    </AppText>
                    {user?.role === "CUSTOMER" &&
                    getCustomerPromoDiscountPercent("CUSTOMER", m) > 0 ? (
                      <AppText variant="caption" color="success">
                        Get {getCustomerPromoDiscountPercent("CUSTOMER", m)}% off by paying{" "}
                        {m === "ONLINE_FULL" ? "the full amount" : "partially"} now
                      </AppText>
                    ) : null}
                    {methodInfo && methodInfo.discountAmount > 0 && methodInfo.discountLabel ? (
                      <Badge
                        label={`${methodInfo.discountLabel} · save ${formatRupees(methodInfo.discountAmount)}`}
                        tone="success"
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {!refereeId && (preview?.walletBalance ?? 0) > 0 ? (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <View style={styles.summaryRow}>
              <AppText variant="subtitle">Kisan4U Wallet</AppText>
              <AppText variant="bodyBold">{formatRupees(preview!.walletBalance)}</AppText>
            </View>
            <TextField
              label="Apply wallet amount (optional)"
              placeholder={`Up to ${formatRupees(walletEligibleCap)}`}
              value={walletAmountInput}
              onChangeText={setWalletAmountInput}
              keyboardType="numeric"
            />
            <AppText variant="caption" color="secondary">
              {activePaymentMethod === "ONLINE_PARTIAL"
                ? "The wallet is applied last, after all discounts, and only comes off the cash-on-delivery balance — the advance is always paid online."
                : activePaymentMethod === "COD"
                  ? "The wallet is applied last, after all discounts; only the rest is paid in cash on delivery."
                  : "The wallet is applied last, after all discounts; only the rest is paid online."}
            </AppText>
          </View>
        ) : null}

        {!refereeId ? (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <AppText variant="subtitle">Coupon</AppText>
            {appliedCouponCode ? (
              <View style={styles.couponAppliedRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Badge label={appliedCouponCode} tone="success" />
                  <AppText variant="caption" color="success">
                    {methodBreakdown?.appliedCoupon
                      ? `${formatRupees(methodBreakdown.appliedCoupon.totalDiscount)} applied`
                      : "Coupon applied"}
                  </AppText>
                </View>
                <Button label="Remove" variant="outline" onPress={handleRemoveCoupon} />
              </View>
            ) : (
              <View style={styles.couponInputBlock}>
                <AppText variant="label" color="secondary">
                  Coupon code
                </AppText>
                <View style={styles.couponInputRow}>
                  <View style={styles.couponFieldWrap}>
                    <TextField
                      placeholder="Enter coupon code"
                      value={couponCodeInput}
                      onChangeText={(value) => {
                        setCouponCodeInput(value.toUpperCase());
                        setCouponError(null);
                      }}
                      autoCapitalize="characters"
                    />
                  </View>
                  <Button
                    label="Apply"
                    onPress={handleApplyCoupon}
                    loading={couponApplying}
                    disabled={!couponCodeInput.trim()}
                  />
                </View>
                {couponError ? (
                  <AppText variant="caption" color="danger">
                    {couponError}
                  </AppText>
                ) : null}
              </View>
            )}
          </View>
        ) : null}

        <View style={[styles.card, styles.priceCard, { borderColor: theme.green100 }]}>
          <AppText variant="subtitle" style={styles.priceCardTitle}>
            Price Summary
          </AppText>
          {preview && methodBreakdown ? (
            <>
              <Row label="Selling price" value={formatRupees(sellingPriceSubtotal)} />
              <Row label="Tax" value={formatRupees(taxTotal)} />
              {isDealer ? (
                <Row
                  label={
                    deliveryMethod === "TRANSPORT" ? "Transportation charge" : "Delivery charge"
                  }
                  value={formatRupees(deliveryTotal)}
                />
              ) : (
                <Row label="Delivery charge" value="Paid by seller" tone="secondary" />
              )}
              {methodBreakdown.discountAmount > 0 && methodBreakdown.discountLabel ? (
                <Row
                  label={methodBreakdown.discountLabel}
                  value={`− ${formatRupees(methodBreakdown.discountAmount)}`}
                  tone="success"
                />
              ) : null}
              {methodBreakdown.appliedCoupon ? (
                <Row
                  label={`Coupon (${methodBreakdown.appliedCoupon.code})`}
                  value={`− ${formatRupees(methodBreakdown.appliedCoupon.totalDiscount)}`}
                  tone="success"
                />
              ) : null}
              {walletApplied > 0 ? (
                <Row
                  label="Wallet applied"
                  value={`− ${formatRupees(walletApplied)}`}
                  tone="success"
                />
              ) : null}
              <View style={[styles.totalRow, { borderTopColor: theme.green100 }]}>
                <AppText variant="bodyBold">Total amount</AppText>
                <AppText variant="subtitle">{formatRupees(methodBreakdown.grandTotal)}</AppText>
              </View>

              <View style={styles.splitTileRow}>
                {partialAdvance ? (
                  <PaymentSplitTile
                    label="Partial payment"
                    sub={`Pay now online${partialAdvance.ruleLabel ? ` · ${partialAdvance.ruleLabel}` : ""}`}
                    amount={split.onlineNow}
                    bg={theme.infoBg}
                    fg={theme.info}
                  />
                ) : null}
                {walletApplied > 0 ? (
                  <PaymentSplitTile
                    label="Wallet payment"
                    sub={walletSubtitle}
                    amount={walletApplied}
                    bg={theme.infoBg}
                    fg={theme.info}
                    full={split.onlineNow <= 0 && split.codDue <= 0}
                  />
                ) : null}
                {split.codDue > 0 ? (
                  <PaymentSplitTile
                    label="COD payment"
                    sub="Pay in cash on delivery"
                    amount={split.codDue}
                    bg={theme.warningBg}
                    fg={theme.warning}
                    full={!partialAdvance && walletApplied <= 0}
                  />
                ) : null}
                {!partialAdvance && split.onlineNow > 0 ? (
                  <PaymentSplitTile
                    label="Pay now online"
                    sub={
                      walletApplied > 0
                        ? "Rest of the amount, paid online"
                        : "Full amount, paid online"
                    }
                    amount={split.onlineNow}
                    bg={theme.infoBg}
                    fg={theme.info}
                    full={walletApplied <= 0}
                  />
                ) : null}
              </View>
            </>
          ) : (
            <AppText variant="caption" color="secondary">
              {previewLoading ? "Calculating…" : "Price breakdown unavailable."}
            </AppText>
          )}
        </View>

        {error ? (
          <AppText variant="body" color="danger">
            {error}
          </AppText>
        ) : null}

        {isGuest ? (
          <AppText variant="caption" color="secondary" style={styles.placeOrderHint}>
            {t("checkout.verifyToContinue")}
          </AppText>
        ) : null}

        <Button
          label={refereeId ? "Send order for approval" : "Place Order"}
          onPress={handlePlaceOrder}
          loading={placing}
          disabled={
            isGuest
              ? true
              : refereeId
                ? refereeNewAddressMode
                  ? !refereeAddress.fullName.trim() || !refereeAddress.stateId
                  : !refereeAddressId
                : guestCheckout
                  ? !isAddressComplete(guestAddress) || !paymentMethod || previewLoading
                  : !addressId || !paymentMethod || previewLoading
          }
          fullWidth
        />
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "success" | "secondary" | "green";
}) {
  return (
    <View style={styles.summaryRow}>
      <AppText
        variant={bold ? "bodyBold" : "body"}
        color={
          tone === "success"
            ? "success"
            : tone === "secondary"
              ? "secondary"
              : tone === "green"
                ? "green"
                : "ink"
        }
      >
        {label}
      </AppText>
      <AppText
        variant={bold ? "bodyBold" : "body"}
        color={tone === "success" ? "success" : tone === "green" ? "green" : "ink"}
      >
        {value}
      </AppText>
    </View>
  );
}

/** One "how much, when" tile in the Price Summary card — Partial payment / COD payment / Pay now online. Colour-coded (never icon-only) so a buyer can't mistake "what this order costs" for "what's due right now". */
function PaymentSplitTile({
  label,
  sub,
  amount,
  bg,
  fg,
  full,
}: {
  label: string;
  sub: string;
  amount: number;
  bg: string;
  fg: string;
  full?: boolean;
}) {
  return (
    <View style={[styles.splitTile, { backgroundColor: bg }, full ? { flexBasis: "100%" } : null]}>
      <AppText
        variant="caption"
        style={{ color: fg, fontWeight: "700", textTransform: "uppercase" }}
      >
        {label}
      </AppText>
      <AppText variant="subtitle" style={{ color: fg }}>
        {formatRupees(amount)}
      </AppText>
      <AppText variant="caption" style={{ color: fg, opacity: 0.85 }}>
        {sub}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  guestBanner: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  section: { gap: Spacing.sm },
  card: { borderWidth: 1.5, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  paymentOption: {
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 4,
    minWidth: "100%",
  },
  couponInputBlock: { gap: Spacing.xxs },
  couponInputRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  couponFieldWrap: { flex: 1 },
  couponAppliedRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  priceCard: { gap: Spacing.sm },
  priceCardTitle: { textTransform: "uppercase", letterSpacing: 0.4 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1.5,
    paddingTop: Spacing.sm,
    marginTop: 2,
  },
  splitTileRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.xs },
  splitTile: {
    flex: 1,
    flexBasis: "45%",
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 2,
  },
  placeOrderHint: { textAlign: "center", marginBottom: -Spacing.sm },
});
