"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, SegmentedToggle, Button, AlertBox, Modal, FormSelect } from "@kisan4u/ui";
import type { PaymentMethod } from "@kisan4u/db";
import type { CartView } from "@kisan4u/orders";
import {
  searchPosCustomersAction,
  searchPosDealersAction,
  listPosAddressesAction,
  getPosCartAction,
  updatePosCartItemQuantityAction,
  removePosCartItemAction,
  clearPosCartAction,
  getPosCheckoutPreviewAction,
  placePosOrderAction,
  type PosCustomerResult,
  type PosDealerResult,
  type PosAddressView,
  type PosCheckoutPreview,
} from "./actions";
import { Combobox } from "./components/combobox";
import { AddCustomerModal } from "./components/add-customer-modal";
import { RegisterDealerModal } from "./components/register-dealer-modal";
import { AddressFormModal } from "./components/address-form-modal";
import { ProductPanel } from "./components/product-panel";
import { ProductDetailModal } from "./components/product-detail-modal";
import { CartPanel } from "./components/cart-panel";
import { CheckoutPanel } from "./components/checkout-panel";
import { PosOrderHistoryModal } from "./components/pos-order-history-modal";
import { computePosPayableAmounts } from "./lib/pos-amounts";

type CustomerType = "CUSTOMER" | "DEALER";
type SelectedPerson = {
  userId: string;
  label: string;
  dealerStateId?: string;
  dealerStateName?: string;
} | null;

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pos-${Date.now()}-${Math.random()}`;
}

function addressLine(a: PosAddressView): string {
  return `${a.fullName}, ${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.cityTown}, ${a.district}, ${a.state} - ${a.pincode}`;
}

export function PosWorkspace() {
  const [customerType, setCustomerType] = useState<CustomerType | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<SelectedPerson>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{
    type: CustomerType;
    person: SelectedPerson;
  } | null>(null);

  const [addresses, setAddresses] = useState<PosAddressView[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [addAddressOpen, setAddAddressOpen] = useState(false);
  const [editAddressOpen, setEditAddressOpen] = useState(false);

  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [registerDealerOpen, setRegisterDealerOpen] = useState(false);
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);

  const [cart, setCart] = useState<CartView | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [productModalId, setProductModalId] = useState<string | null>(null);

  const [preview, setPreview] = useState<PosCheckoutPreview | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"KISAN4U_COURIER" | "TRANSPORT">(
    "KISAN4U_COURIER",
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [transportNote, setTransportNote] = useState("");
  const [walletAmountInput, setWalletAmountInput] = useState(0);
  const [posAdvanceAmountInput, setPosAdvanceAmountInput] = useState(0);
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | undefined>(undefined);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeSuccess, setPlaceSuccess] = useState<{
    checkoutGroupId: string;
    groupNumber: string;
  } | null>(null);
  const [isPlacing, startPlacing] = useTransition();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const hasProgress = Boolean(
    selectedPerson &&
    (selectedAddressId || (cart && cart.sellerGroups.some((g) => g.items.length > 0))),
  );

  function resetOrderState() {
    setAddresses([]);
    setSelectedAddressId(null);
    setCart(null);
    setPreview(null);
    setDeliveryMethod("KISAN4U_COURIER");
    setPaymentMethod("");
    setTransportNote("");
    setWalletAmountInput(0);
    setPosAdvanceAmountInput(0);
    setCouponCodeInput("");
    setAppliedCouponCode(undefined);
    setIdempotencyKey(newIdempotencyKey());
    setPlaceError(null);
    setPlaceSuccess(null);
  }

  async function applySwitch(type: CustomerType, person: SelectedPerson) {
    if (selectedPerson) await clearPosCartAction(selectedPerson.userId);
    resetOrderState();
    setCustomerType(type);
    setSelectedPerson(person);
    setPendingSwitch(null);
    setRefreshKey((k) => k + 1);
  }

  function requestSwitch(type: CustomerType, person: SelectedPerson) {
    if (hasProgress) {
      setPendingSwitch({ type, person });
    } else {
      applySwitch(type, person);
    }
  }

  async function handleCancelOrder() {
    if (selectedPerson) await clearPosCartAction(selectedPerson.userId);
    resetOrderState();
    setCustomerType(null);
    setSelectedPerson(null);
    setCancelConfirmOpen(false);
    setRefreshKey((k) => k + 1);
  }

  // Load addresses whenever the active person changes.
  useEffect(() => {
    if (!selectedPerson) return;
    listPosAddressesAction(selectedPerson.userId).then((result) => {
      if (result.ok) {
        setAddresses(result.data);
        const def =
          result.data.find((a) => a.isDefault && a.eligible) ?? result.data.find((a) => a.eligible);
        setSelectedAddressId(def?.id ?? null);
      }
    });
  }, [selectedPerson]);

  // Load cart whenever the active person or refreshKey changes.
  useEffect(() => {
    if (!selectedPerson) return;
    getPosCartAction(selectedPerson.userId).then((result) => {
      if (result.ok) setCart(result.data);
    });
  }, [selectedPerson, refreshKey]);

  // Load the checkout preview whenever anything that affects pricing
  // changes — including paymentMethod itself: buildCheckoutDrafts applies a
  // payment-method-dependent promo discount (see calculateCustomerPromoDiscount
  // in packages/orders), so grandTotal genuinely differs between e.g. COD and
  // ONLINE_FULL. The setPaymentMethod call below only fires when the current
  // value is actually invalid for this preview, so including it in the deps
  // converges (at most one extra run) rather than looping or fighting a
  // manual selection.
  useEffect(() => {
    if (!selectedPerson) return;
    getPosCheckoutPreviewAction(selectedPerson.userId, {
      deliveryMethod,
      paymentMethod: paymentMethod || "COD",
      couponCode: appliedCouponCode,
    }).then((result) => {
      if (!result.ok) return;
      setPreview(result.data);
      if (!paymentMethod || !result.data.allowedPaymentMethods.includes(paymentMethod)) {
        setPaymentMethod(result.data.allowedPaymentMethods[0] ?? "");
      }
      if (result.data.deliveryMethod !== deliveryMethod)
        setDeliveryMethod(result.data.deliveryMethod);
    });
  }, [selectedPerson, deliveryMethod, paymentMethod, appliedCouponCode, refreshKey]);

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) ?? null;
  const deliveryAddressText = selectedAddress ? addressLine(selectedAddress) : null;

  const { walletApplied, payableAfterWallet } = computePosPayableAmounts(
    preview,
    paymentMethod,
    walletAmountInput,
    posAdvanceAmountInput,
  );
  const cartHasItems = Boolean(cart && cart.sellerGroups.some((g) => g.items.length > 0));
  const cartHasErrors = Boolean(cart?.hasValidationErrors);

  const canPlaceOrder =
    Boolean(selectedPerson) &&
    Boolean(selectedAddressId) &&
    cartHasItems &&
    !cartHasErrors &&
    Boolean(paymentMethod) &&
    (deliveryMethod !== "TRANSPORT" || transportNote.trim().length > 0) &&
    // A partial order's amount to collect now is entered against what is
    // left after the wallet; a wallet that covers everything needs none.
    (paymentMethod !== "ONLINE_PARTIAL" ||
      payableAfterWallet <= 0 ||
      (posAdvanceAmountInput > 0 && posAdvanceAmountInput < payableAfterWallet));

  function handlePlaceOrder() {
    if (!selectedPerson || !selectedAddressId || !paymentMethod) return;
    setPlaceError(null);
    startPlacing(async () => {
      const result = await placePosOrderAction({
        targetUserId: selectedPerson.userId,
        deliveryMethod,
        paymentMethod,
        transportNote: deliveryMethod === "TRANSPORT" ? transportNote : undefined,
        addressId: selectedAddressId,
        walletAmountApplied: walletApplied > 0 ? walletApplied : undefined,
        idempotencyKey,
        posAdvanceAmount: paymentMethod === "ONLINE_PARTIAL" ? posAdvanceAmountInput : undefined,
        couponCode: appliedCouponCode,
      });
      if (!result.ok) {
        setPlaceError(result.error);
        // A failed attempt burns this idempotency key — mint a fresh one so
        // the operator can just fix the issue and click Place Order again
        // (the server also lets a FAILED key be retried, but a clean key
        // avoids any FAILED->PENDING churn on the same row).
        setIdempotencyKey(newIdempotencyKey());
        return;
      }
      setPlaceSuccess(result);
    });
  }

  function handleStartNewOrder() {
    setCustomerType(null);
    setSelectedPerson(null);
    resetOrderState();
  }

  if (placeSuccess) {
    return (
      <Card className="mx-auto max-w-lg p-6 text-center">
        <AlertBox tone="success" title="Order placed">
          Order {placeSuccess.groupNumber} was created successfully.
        </AlertBox>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => window.open(`/admin/pos/orders`, "_blank")}>
            View Orders
          </Button>
          <Button variant="primary" onClick={handleStartNewOrder}>
            Start New Order
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-140px)] lg:flex-row">
      <Card className="flex min-h-0 flex-col p-4 lg:w-[58%]">
        {!selectedPerson ? (
          <AlertBox tone="info">
            Select a customer type and a customer/dealer to start browsing products.
          </AlertBox>
        ) : (
          <ProductPanel
            targetUserId={selectedPerson.userId}
            refreshKey={refreshKey}
            onSelectProduct={setProductModalId}
          />
        )}
      </Card>

      <Card className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4 lg:w-[42%]">
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">
            1. Customer Type
          </div>
          <SegmentedToggle
            options={[
              { value: "CUSTOMER", label: "Registered Customer" },
              { value: "DEALER", label: "Approved Dealer" },
            ]}
            value={customerType ?? "CUSTOMER"}
            onChange={(v) => requestSwitch(v, null)}
          />
        </div>

        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">
            2. Customer / Dealer
          </div>
          {selectedPerson ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border-[1.5px] border-green-600 bg-green-50 p-3 text-sm">
              <span className="min-w-0 break-words font-semibold text-ink">{selectedPerson.label}</span>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setOrderHistoryOpen(true)}>
                  Past orders
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => requestSwitch(customerType ?? "CUSTOMER", null)}
                >
                  Change
                </Button>
              </div>
            </div>
          ) : customerType === "DEALER" ? (
            <div className="flex flex-col gap-2">
              <Combobox<PosDealerResult>
                placeholder="Search by dealer/store name, phone, or GST"
                fetchOptions={async (q) => {
                  const r = await searchPosDealersAction(q);
                  return r.ok ? r.data : [];
                }}
                getKey={(d) => d.id}
                renderOption={(d) => (
                  <span>
                    <span className="font-semibold text-ink">{d.storeName ?? d.name}</span> —{" "}
                    {d.name}
                    {d.maskedPhone ? ` · ${d.maskedPhone}` : ""}
                    {d.stateName ? ` · ${d.stateName}` : ""}
                  </span>
                )}
                onSelect={(d) =>
                  requestSwitch("DEALER", {
                    userId: d.userId,
                    label: `${d.storeName ?? d.name} (${d.name})`,
                    dealerStateId: d.stateId ?? undefined,
                    dealerStateName: d.stateName ?? undefined,
                  })
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRegisterDealerOpen(true)}
              >
                Register New Dealer
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Combobox<PosCustomerResult>
                placeholder="Search by name, phone, or email"
                fetchOptions={async (q) => {
                  const r = await searchPosCustomersAction(q);
                  return r.ok ? r.data : [];
                }}
                getKey={(c) => c.id}
                renderOption={(c) => (
                  <span>
                    <span className="font-semibold text-ink">{c.name}</span>
                    {c.maskedPhone ? ` · ${c.maskedPhone}` : ""}
                    {c.city ? ` · ${c.city}` : ""}
                  </span>
                )}
                onSelect={(c) => requestSwitch("CUSTOMER", { userId: c.id, label: c.name })}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddCustomerOpen(true)}
              >
                Add New Customer
              </Button>
            </div>
          )}
        </div>

        {selectedPerson && (
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">
              3. Delivery Address
            </div>
            {addresses.length > 0 && (
              <FormSelect
                label=""
                value={selectedAddressId ?? ""}
                onChange={(e) => setSelectedAddressId(e.target.value)}
              >
                <option value="">— Select an address —</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.eligible}>
                    {addressLine(a)}
                    {!a.eligible ? " (outside dealer state — not selectable)" : ""}
                  </option>
                ))}
              </FormSelect>
            )}
            {selectedAddress && (
              <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-gray-700">
                    Full delivery address
                    <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                      {selectedAddress.addressType}
                    </span>
                    {selectedAddress.isDefault && (
                      <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                        Default
                      </span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditAddressOpen(true)}
                  >
                    Edit address
                  </Button>
                </div>
                <div className="text-gray-700">{selectedAddress.fullName}</div>
                <div className="text-gray-600">
                  {selectedAddress.mobile}
                  {selectedAddress.altMobile ? ` / ${selectedAddress.altMobile}` : ""}
                </div>
                <div className="text-gray-600">
                  {selectedAddress.line1}
                  {selectedAddress.line2 ? `, ${selectedAddress.line2}` : ""}
                  {selectedAddress.landmark ? ` (near ${selectedAddress.landmark})` : ""}
                </div>
                <div className="text-gray-600">
                  {selectedAddress.cityTown}
                  {selectedAddress.district ? `, ${selectedAddress.district}` : ""}
                </div>
                <div className="text-gray-600">
                  {selectedAddress.state} - {selectedAddress.pincode}
                </div>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setAddAddressOpen(true)}
            >
              Add New Address
            </Button>
          </div>
        )}

        {selectedPerson && selectedAddressId && (
          <>
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">
                4-5. Cart
              </div>
              <CartPanel
                cart={cart}
                isMutating={false}
                onUpdateQuantity={(cartItemId, quantity) => {
                  updatePosCartItemQuantityAction(selectedPerson.userId, {
                    cartItemId,
                    quantity,
                  }).then(() => setRefreshKey((k) => k + 1));
                }}
                onRemove={(cartItemId) => {
                  removePosCartItemAction(selectedPerson.userId, cartItemId).then(() =>
                    setRefreshKey((k) => k + 1),
                  );
                }}
              />
            </div>

            {cartHasItems && !cartHasErrors && (
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">
                  6-7. Delivery, Payment &amp; Total
                </div>
                <CheckoutPanel
                  role={customerType ?? "CUSTOMER"}
                  preview={preview}
                  deliveryMethod={deliveryMethod}
                  onDeliveryMethodChange={setDeliveryMethod}
                  paymentMethod={paymentMethod}
                  onPaymentMethodChange={setPaymentMethod}
                  transportNote={transportNote}
                  onTransportNoteChange={setTransportNote}
                  walletAmountInput={walletAmountInput}
                  onWalletAmountInputChange={setWalletAmountInput}
                  posAdvanceAmountInput={posAdvanceAmountInput}
                  onPosAdvanceAmountInputChange={setPosAdvanceAmountInput}
                  couponCodeInput={couponCodeInput}
                  onCouponCodeInputChange={setCouponCodeInput}
                  appliedCouponCode={appliedCouponCode}
                  onApplyCoupon={() => setAppliedCouponCode(couponCodeInput.trim() || undefined)}
                  onRemoveCoupon={() => {
                    setAppliedCouponCode(undefined);
                    setCouponCodeInput("");
                  }}
                />
              </div>
            )}

            {placeError && <AlertBox tone="danger">{placeError}</AlertBox>}

            <div className="mt-auto flex gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                fullWidth
                onClick={() => setCancelConfirmOpen(true)}
              >
                Cancel Order
              </Button>
              <Button
                type="button"
                variant="primary"
                fullWidth
                onClick={handlePlaceOrder}
                disabled={!canPlaceOrder || isPlacing}
              >
                {isPlacing ? "Placing…" : "Place Order"}
              </Button>
            </div>
          </>
        )}
      </Card>

      <AddCustomerModal
        open={addCustomerOpen}
        onClose={() => setAddCustomerOpen(false)}
        onCreated={(userId, label) => {
          setAddCustomerOpen(false);
          applySwitch("CUSTOMER", { userId, label }).then(() => setAddAddressOpen(true));
        }}
        onSelectExisting={(userId, label) => {
          setAddCustomerOpen(false);
          requestSwitch("CUSTOMER", { userId, label });
        }}
      />
      <RegisterDealerModal open={registerDealerOpen} onClose={() => setRegisterDealerOpen(false)} />

      {selectedPerson && (
        <PosOrderHistoryModal
          open={orderHistoryOpen}
          onClose={() => setOrderHistoryOpen(false)}
          targetUserId={selectedPerson.userId}
          label={selectedPerson.label}
        />
      )}

      {selectedPerson && (
        <AddressFormModal
          open={addAddressOpen}
          onClose={() => setAddAddressOpen(false)}
          targetUserId={selectedPerson.userId}
          dealerLockedState={
            customerType === "DEALER" && selectedPerson.dealerStateId
              ? { id: selectedPerson.dealerStateId, name: selectedPerson.dealerStateName ?? "" }
              : null
          }
          onSaved={(addressId) => {
            setAddAddressOpen(false);
            listPosAddressesAction(selectedPerson.userId).then((result) => {
              if (result.ok) {
                setAddresses(result.data);
                setSelectedAddressId(addressId);
              }
            });
          }}
        />
      )}

      {selectedPerson && selectedAddress && (
        <AddressFormModal
          open={editAddressOpen}
          onClose={() => setEditAddressOpen(false)}
          targetUserId={selectedPerson.userId}
          editAddressId={selectedAddress.id}
          dealerLockedState={
            customerType === "DEALER" && selectedPerson.dealerStateId
              ? { id: selectedPerson.dealerStateId, name: selectedPerson.dealerStateName ?? "" }
              : null
          }
          initial={{
            fullName: selectedAddress.fullName,
            mobile: selectedAddress.mobile,
            altMobile: selectedAddress.altMobile ?? "",
            line1: selectedAddress.line1,
            line2: selectedAddress.line2 ?? "",
            landmark: selectedAddress.landmark ?? "",
            cityTown: selectedAddress.cityTown,
            district: selectedAddress.district ?? "",
            state: selectedAddress.state,
            stateId: selectedAddress.stateId ?? "",
            pincode: selectedAddress.pincode,
            addressType: selectedAddress.addressType,
            isDefault: selectedAddress.isDefault,
          }}
          onSaved={(addressId) => {
            setEditAddressOpen(false);
            listPosAddressesAction(selectedPerson.userId).then((result) => {
              if (result.ok) {
                setAddresses(result.data);
                setSelectedAddressId(addressId);
              }
            });
          }}
        />
      )}

      {selectedPerson && (
        <ProductDetailModal
          open={Boolean(productModalId)}
          onClose={() => setProductModalId(null)}
          targetUserId={selectedPerson.userId}
          productId={productModalId}
          deliveryAddressText={deliveryAddressText}
          dealerStateName={selectedPerson.dealerStateName ?? null}
          onAddedToCart={() => setRefreshKey((k) => k + 1)}
          onRequestSubmitted={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <Modal
        open={Boolean(pendingSwitch)}
        onClose={() => setPendingSwitch(null)}
        title="Switch customer?"
      >
        <AlertBox tone="warning">
          Changing the customer type or selected customer/dealer will clear the current cart,
          delivery, and payment selections. Continue?
        </AlertBox>
        <div className="mt-4 flex gap-2">
          <Button
            variant="danger"
            onClick={() => pendingSwitch && applySwitch(pendingSwitch.type, pendingSwitch.person)}
          >
            Yes, switch
          </Button>
          <Button variant="outline" onClick={() => setPendingSwitch(null)}>
            Stay on current order
          </Button>
        </div>
      </Modal>

      <Modal
        open={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        title="Cancel this order?"
      >
        <AlertBox tone="warning">
          This clears the cart, address, delivery, and payment selections for this customer/dealer.
        </AlertBox>
        <div className="mt-4 flex gap-2">
          <Button variant="danger" onClick={handleCancelOrder}>
            Yes, cancel order
          </Button>
          <Button variant="outline" onClick={() => setCancelConfirmOpen(false)}>
            Keep working
          </Button>
        </div>
      </Modal>
    </div>
  );
}
