"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { AlertBox, Button, FormInput, FormSelect, Modal, formatCurrency } from "@kisan4u/ui";
import { INDIAN_STATES } from "@kisan4u/validators";
import {
  DELHIVERY_ACCOUNTS,
  type LogisticsPartner,
  type LogisticsPartnerKey,
  type DelhiveryAccountKey,
} from "@/lib/logistics-partners";

export type WizardOrderAddress = {
  sellerOrderId: string;
  checkoutGroupId: string;
  siblingOrderCount: number;
  fullName: string;
  mobile: string;
  altMobile: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  cityTown: string;
  district: string;
  state: string;
  stateId: string | null;
  pincode: string;
  addressType: "HOME" | "FARM" | "SHOP" | "OFFICE" | "OTHER";
};

type AddressFormState = {
  fullName: string;
  mobile: string;
  altMobile: string;
  line1: string;
  line2: string;
  landmark: string;
  cityTown: string;
  district: string;
  state: string;
  pincode: string;
};

function addressToForm(a: WizardOrderAddress): AddressFormState {
  return {
    fullName: a.fullName,
    mobile: a.mobile,
    altMobile: a.altMobile ?? "",
    line1: a.line1,
    line2: a.line2 ?? "",
    landmark: a.landmark ?? "",
    cityTown: a.cityTown,
    district: a.district,
    state: a.state,
    pincode: a.pincode,
  };
}

export type WizardPickupPoint = {
  id: string;
  name: string;
  contactPerson: string;
  mobile: string;
  line1: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  landmark: string | null;
  isDefault: boolean;
};

type SubmitResult = { ok: true } | { ok: false; error: string };

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-[11px] font-bold text-green-700">
          {n}
        </span>
        <span className="min-w-0 break-words">{title}</span>
      </h3>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function LogisticsWizardModal({
  open,
  onClose,
  orderNumber,
  sellerOrderId,
  paymentMethod,
  codAmount,
  partners,
  loadPickupPoints,
  submit,
  onDone,
  loadAddress,
  updateAddress,
}: {
  open: boolean;
  onClose: () => void;
  orderNumber: string;
  sellerOrderId: string;
  paymentMethod: string;
  codAmount?: number;
  partners: LogisticsPartner[];
  loadPickupPoints: (sellerOrderId: string) => Promise<WizardPickupPoint[]>;
  submit: (input: {
    sellerOrderId: string;
    partner: LogisticsPartnerKey;
    pickupPointId: string;
    delhiveryAccount?: DelhiveryAccountKey;
    packageLengthCm: number;
    packageBreadthCm: number;
    packageHeightCm: number;
    packageWeightGrams: number;
  }) => Promise<SubmitResult>;
  onDone: () => void;
  /** Admin-only: shows a "Delivery Address" section that can be viewed and corrected. Omitted entirely (no props) for the seller-facing wizard. */
  loadAddress?: (sellerOrderId: string) => Promise<WizardOrderAddress | null>;
  updateAddress?: (input: { sellerOrderId: string } & AddressFormState) => Promise<SubmitResult>;
}) {
  const isCod = paymentMethod === "COD";
  const shipmentType = isCod ? "COD" : "Prepaid";

  const [partner, setPartner] = useState<LogisticsPartnerKey | null>(null);
  const [delhiveryAccount, setDelhiveryAccount] = useState<DelhiveryAccountKey>("MARKETING1");
  const [pickupPoints, setPickupPoints] = useState<WizardPickupPoint[] | null>(null);
  const [pickupPointId, setPickupPointId] = useState("");
  const [lengthCm, setLengthCm] = useState("");
  const [breadthCm, setBreadthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightGrams, setWeightGrams] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);

  const [address, setAddress] = useState<WizardOrderAddress | null>(null);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressFormState | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPartner(null);
    setDelhiveryAccount("MARKETING1");
    setPickupPointId("");
    setLengthCm("");
    setBreadthCm("");
    setHeightCm("");
    setWeightGrams("");
    setError(null);
    setSubmitting(false);
    setEditingAddress(false);
    setAddressError(null);
    setAddress(null);
    setAddressForm(null);
    if (loadAddress) {
      setLoadingAddress(true);
      loadAddress(sellerOrderId)
        .then((a) => setAddress(a))
        .catch(() => setAddress(null))
        .finally(() => setLoadingAddress(false));
    }
    setPickupPoints(null);
    setLoadingPoints(true);
    loadPickupPoints(sellerOrderId)
      .then((points) => {
        setPickupPoints(points);
        const preferred = points.find((p) => p.isDefault) ?? points[0];
        if (preferred) setPickupPointId(preferred.id);
      })
      .catch(() => setPickupPoints([]))
      .finally(() => setLoadingPoints(false));
  }, [open, sellerOrderId, loadPickupPoints]);

  const selectedPoint = useMemo(
    () => pickupPoints?.find((p) => p.id === pickupPointId) ?? null,
    [pickupPoints, pickupPointId],
  );

  const dims = {
    packageLengthCm: Number(lengthCm),
    packageBreadthCm: Number(breadthCm),
    packageHeightCm: Number(heightCm),
    packageWeightGrams: Number(weightGrams),
  };
  const dimsValid = Object.values(dims).every((v) => Number.isFinite(v) && v > 0);

  function partnerDisabled(p: LogisticsPartner): string | null {
    if (isCod && p.prepaidOnly) return "Prepaid only — cannot carry this COD order";
    if (isCod && !p.codAvailable) return "No COD service";
    return null;
  }

  const hasAddressSection = !!loadAddress;
  const sectionNumber = {
    partner: 1,
    address: 2,
    pickup: hasAddressSection ? 3 : 2,
    shipment: hasAddressSection ? 4 : 3,
    review: hasAddressSection ? 5 : 4,
  };

  function startEditAddress() {
    if (!address) return;
    setAddressForm(addressToForm(address));
    setAddressError(null);
    setEditingAddress(true);
  }

  function saveAddress() {
    if (!addressForm || !updateAddress) return;
    setAddressError(null);
    if (!addressForm.fullName.trim() || !addressForm.mobile.trim() || !addressForm.line1.trim() ||
        !addressForm.cityTown.trim() || !addressForm.district.trim() || !addressForm.state.trim() ||
        !addressForm.pincode.trim()) {
      setAddressError("Fill in the required address fields before saving.");
      return;
    }
    setSavingAddress(true);
    updateAddress({ sellerOrderId, ...addressForm })
      .then((result) => {
        setSavingAddress(false);
        if (!result.ok) {
          setAddressError(result.error);
          return;
        }
        setAddress((prev) => (prev ? { ...prev, ...addressForm, altMobile: addressForm.altMobile || null, line2: addressForm.line2 || null, landmark: addressForm.landmark || null } : prev));
        setEditingAddress(false);
      })
      .catch(() => {
        setSavingAddress(false);
        setAddressError("Something went wrong saving the address. Try again.");
      });
  }

  function create() {
    setError(null);
    if (!partner) {
      setError(`Section ${sectionNumber.partner}: choose a logistics partner.`);
      return;
    }
    if (!pickupPointId) {
      setError(`Section ${sectionNumber.pickup}: choose a pickup warehouse.`);
      return;
    }
    if (!dimsValid) {
      setError(`Section ${sectionNumber.shipment}: enter length, breadth, height (cm) and weight (g) — all greater than zero.`);
      return;
    }
    setSubmitting(true);
    submit({
      sellerOrderId,
      partner,
      pickupPointId,
      delhiveryAccount: partner === "DELHIVERY" ? delhiveryAccount : undefined,
      ...dims,
    })
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          setSubmitting(false);
          return;
        }
        onDone();
        onClose();
      })
      .catch(() => {
        setError("Something went wrong creating the shipment. Try again.");
        setSubmitting(false);
      });
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Create Shipment" className="max-w-2xl">
      <p className="mb-5 text-[13px] text-gray-600">
        Order ID: <span className="font-semibold text-ink">{orderNumber}</span>
      </p>

      {/* Single column throughout — a previous two-column split (Address +
          Pickup beside Shipment Details) left a tall column next to a much
          shorter one, with a large uneven gap under the short side. One
          straightforward top-to-bottom flow reads better in a modal this
          width and never mismatches height like that. */}
      <div className="flex min-w-0 flex-col gap-5 overflow-x-hidden">
        <Section n={sectionNumber.partner} title="Select Logistics Partner">
          <p className="mb-3 text-xs text-gray-600">Choose a logistics partner to create the shipment.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {partners.map((p) => {
              const disabledReason = partnerDisabled(p);
              const selected = partner === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={!!disabledReason}
                  onClick={() => setPartner(p.key)}
                  className={`min-w-0 rounded-lg border p-3 text-left transition ${
                    selected
                      ? "border-green-600 bg-green-50"
                      : disabledReason
                        ? "cursor-not-allowed border-border bg-surface opacity-60"
                        : "border-border bg-surface hover:border-green-400"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-bold text-ink">{p.name}</span>
                    {selected && <span className="shrink-0 text-green-600">✓</span>}
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-gray-600">{p.description}</div>
                  <div className="mt-1.5 text-[11px] font-medium text-ink">
                    {p.prepaidOnly ? "Prepaid Only" : "COD Available"}
                  </div>
                  <div className="break-words text-[11px] text-gray-600">{p.etaText}</div>
                  {disabledReason && (
                    <div className="mt-1 break-words text-[11px] font-medium text-danger">
                      {disabledReason}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {partner === "DELHIVERY" && (
            <div className="mt-3">
              <FormSelect
                label="Delhivery account"
                value={delhiveryAccount}
                onChange={(e) => setDelhiveryAccount(e.target.value as DelhiveryAccountKey)}
              >
                {DELHIVERY_ACCOUNTS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </FormSelect>
            </div>
          )}
        </Section>

        {hasAddressSection && (
          <Section n={sectionNumber.address} title="Delivery Address">
            {loadingAddress ? (
              <p className="text-xs text-gray-600">Loading delivery address…</p>
            ) : !address ? (
              <AlertBox tone="warning">No delivery address found for this order.</AlertBox>
            ) : editingAddress && addressForm ? (
              <div className="flex flex-col gap-3">
                {address.siblingOrderCount > 0 && (
                  <AlertBox tone="info">
                    This address is shared by {address.siblingOrderCount} other order
                    {address.siblingOrderCount === 1 ? "" : "s"} from the same checkout — saving here
                    updates the delivery address for all of them.
                  </AlertBox>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormInput
                    label="Full name"
                    value={addressForm.fullName}
                    onChange={(e) => setAddressForm({ ...addressForm, fullName: e.target.value })}
                  />
                  <FormInput
                    label="Mobile"
                    value={addressForm.mobile}
                    onChange={(e) => setAddressForm({ ...addressForm, mobile: e.target.value })}
                  />
                  <FormInput
                    label="Alternate mobile"
                    value={addressForm.altMobile}
                    onChange={(e) => setAddressForm({ ...addressForm, altMobile: e.target.value })}
                  />
                  <FormInput
                    label="Pincode"
                    value={addressForm.pincode}
                    onChange={(e) => setAddressForm({ ...addressForm, pincode: e.target.value })}
                  />
                </div>
                <FormInput
                  label="Address line 1"
                  value={addressForm.line1}
                  onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })}
                />
                <FormInput
                  label="Address line 2"
                  value={addressForm.line2}
                  onChange={(e) => setAddressForm({ ...addressForm, line2: e.target.value })}
                />
                <FormInput
                  label="Landmark"
                  value={addressForm.landmark}
                  onChange={(e) => setAddressForm({ ...addressForm, landmark: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormInput
                    label="City / Town"
                    value={addressForm.cityTown}
                    onChange={(e) => setAddressForm({ ...addressForm, cityTown: e.target.value })}
                  />
                  <FormInput
                    label="District"
                    value={addressForm.district}
                    onChange={(e) => setAddressForm({ ...addressForm, district: e.target.value })}
                  />
                </div>
                <FormSelect
                  label="State"
                  value={addressForm.state}
                  onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })}
                >
                  <option value="">Select a state…</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </FormSelect>
                {addressError && <p className="break-words text-xs font-medium text-danger">{addressError}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingAddress(false)} disabled={savingAddress}>
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={saveAddress} loading={savingAddress}>
                    Save address
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface-alt p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5 text-[13px] text-gray-700">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-bold text-ink">{address.fullName}</span>
                      <span className="rounded-full bg-border/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                        {address.addressType}
                      </span>
                    </div>
                    <div className="tabular-nums">
                      {address.mobile}
                      {address.altMobile ? ` · ${address.altMobile}` : ""}
                    </div>
                    <address className="not-italic leading-relaxed break-words">
                      {[address.line1, address.line2, address.landmark]
                        .filter(Boolean)
                        .join(", ")}
                      <br />
                      {address.cityTown}, {address.district}
                      <br />
                      {address.state} — <span className="font-semibold text-ink">{address.pincode}</span>
                    </address>
                  </div>
                  {updateAddress && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={startEditAddress}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Section>
        )}

        <Section n={sectionNumber.pickup} title="Select Pickup Warehouse">
          {loadingPoints ? (
            <p className="text-xs text-gray-600">Loading pickup warehouses…</p>
          ) : pickupPoints && pickupPoints.length === 0 ? (
            <AlertBox tone="warning">
              This seller has no approved, active pickup point yet. It must be added and approved
              before the order can be dispatched.
            </AlertBox>
          ) : (
            <>
              <FormSelect value={pickupPointId} onChange={(e) => setPickupPointId(e.target.value)}>
                {pickupPoints?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? " (Default)" : ""}
                  </option>
                ))}
              </FormSelect>
              {selectedPoint && (
                <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-surface-alt p-4 text-[13px] text-gray-700">
                  <div className="text-sm font-bold text-ink">{selectedPoint.name}</div>
                  <div className="tabular-nums">
                    {selectedPoint.contactPerson} · {selectedPoint.mobile}
                  </div>
                  <address className="not-italic leading-relaxed break-words">
                    {[selectedPoint.line1, selectedPoint.landmark].filter(Boolean).join(", ")}
                    <br />
                    {selectedPoint.city}, {selectedPoint.district}
                    <br />
                    {selectedPoint.state} —{" "}
                    <span className="font-semibold text-ink">{selectedPoint.pincode}</span>
                  </address>
                </div>
              )}
            </>
          )}
        </Section>

        <Section n={sectionNumber.shipment} title="Shipment Details">
          <p className="mb-3 text-xs text-gray-600">Enter the packed parcel dimensions and weight.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FormInput label="Length (cm)" type="number" min={0} value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} />
            <FormInput label="Breadth (cm)" type="number" min={0} value={breadthCm} onChange={(e) => setBreadthCm(e.target.value)} />
            <FormInput label="Height (cm)" type="number" min={0} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
            <FormInput label="Weight (g)" type="number" min={0} value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} />
          </div>
          {/* One summary box, not two — the shipment-type radios that used
              to sit above this said the exact same COD/Prepaid fact a
              second time, as fake-interactive controls that couldn't
              actually be changed. */}
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt p-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Payment mode</div>
              <div className="text-sm font-bold text-ink">{shipmentType === "COD" ? "Cash on Delivery" : "Prepaid"}</div>
              <div className="mt-0.5 text-[11px] text-gray-500">Set from the order&apos;s payment method — not editable here.</div>
            </div>
            {shipmentType === "COD" && codAmount != null && (
              <div className="shrink-0 text-right">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Collectable amount</div>
                <div className="text-sm font-bold text-ink">{formatCurrency(codAmount)}</div>
              </div>
            )}
          </div>
        </Section>

        <Section n={sectionNumber.review} title="Review & preflight">
          <div className="flex flex-col gap-4">
            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
              <Row label="Logistics partner" value={partners.find((p) => p.key === partner)?.name ?? "— not chosen —"} />
              {partner === "DELHIVERY" && (
                <Row
                  label="Delhivery account"
                  value={
                    DELHIVERY_ACCOUNTS.find((a) => a.key === delhiveryAccount)?.label ?? delhiveryAccount
                  }
                />
              )}
              <Row label="Pickup warehouse" value={selectedPoint?.name ?? "— not chosen —"} />
              <Row
                label="Parcel"
                value={
                  dimsValid ? `${lengthCm} × ${breadthCm} × ${heightCm} cm, ${weightGrams} g` : "— incomplete —"
                }
              />
              <Row label="Shipment type" value={shipmentType} />
            </dl>
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-green-800">
                Preflight checklist
              </div>
              <ul className="flex flex-col gap-1.5 text-[13px] text-green-900">
                <PreflightItem ok={!!address || !hasAddressSection} label="Delivery address validated" />
                <PreflightItem ok={!!partner} label="Logistics partner selected" />
                <PreflightItem ok={!!pickupPointId} label="Pickup warehouse selected" />
                <PreflightItem ok={dimsValid} label="Package details complete" />
                <PreflightItem ok label="Payment values match order" />
                {/* Structural guarantee, not a live check — this wizard only
                    ever launches for a CONFIRMED order with no Shipment row
                    yet (Shipment.sellerOrderId is unique, and the launcher
                    itself only renders pre-dispatch — see
                    DispatchWizardLauncher's render condition). */}
                <PreflightItem ok label="No existing AWB found" />
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-600">
            Creating the shipment accepts the order, marks it packed, and schedules pickup — the
            order moves to <span className="font-semibold text-ink">Pickup scheduled</span>.
          </p>
        </Section>
      </div>

      {error && <p className="mt-3 break-words text-xs font-medium text-danger">{error}</p>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={create}
          loading={submitting}
          disabled={loadingPoints || (pickupPoints?.length ?? 0) === 0}
        >
          {partner
            ? `Create shipment via ${partners.find((p) => p.key === partner)?.name ?? "partner"}`
            : "Create Shipment"}
        </Button>
      </div>
    </Modal>
  );
}

function PreflightItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <Check
        className={`h-3.5 w-3.5 shrink-0 ${ok ? "text-green-600" : "text-gray-300"}`}
        aria-hidden="true"
      />
      <span className={ok ? "" : "text-gray-400"}>{label}</span>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-gray-600">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
