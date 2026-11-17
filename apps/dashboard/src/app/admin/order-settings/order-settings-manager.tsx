"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActiveBadge,
  AlertBox,
  Badge,
  Button,
  Card,
  FormInput,
  FormSelect,
  RecordList,
  RecordListRow,
  SectionHeader,
  formatCurrency,
} from "@kisan4u/ui";
import {
  savePartialPaymentConfigAction,
  togglePartialPaymentConfigAction,
  saveCollectionChargeConfigAction,
  toggleCollectionChargeConfigAction,
  saveSettlementRateConfigAction,
  toggleSettlementRateConfigAction,
} from "./actions";

export type PartialConfigRow = {
  id: string;
  label: string;
  appliesTo: string | null;
  ruleType: string;
  value: string;
  isActive: boolean;
  isDemo: boolean;
};

export type CollectionConfigRow = {
  id: string;
  label: string;
  chargeType: string;
  value: string;
  minCharge: string | null;
  isActive: boolean;
};

export type SettlementRateConfigRow = {
  id: string;
  label: string;
  commissionGstPercent: string;
  logisticsGstPercent: string;
  collectionChargeGstPercent: string;
  isActive: boolean;
};

const APPLIES_TO_LABEL: Record<string, string> = {
  CUSTOMER: "Customer only",
  DEALER: "Dealer only",
};

function formatRuleValue(ruleType: string, value: string): string {
  return ruleType === "FIXED_AMOUNT" ? formatCurrency(value) : `${value}%`;
}

function formatChargeValue(chargeType: string, value: string): string {
  return chargeType === "PERCENTAGE" ? `${value}%` : formatCurrency(value);
}

export function OrderSettingsManager({
  partialConfigs,
  collectionConfigs,
  settlementRateConfigs,
}: {
  partialConfigs: PartialConfigRow[];
  collectionConfigs: CollectionConfigRow[];
  settlementRateConfigs: SettlementRateConfigRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [partialForm, setPartialForm] = useState({
    label: "",
    appliesTo: "",
    ruleType: "PERCENTAGE",
    value: "20",
    isDemo: true,
  });
  const [collectionForm, setCollectionForm] = useState({
    label: "",
    chargeType: "FLAT",
    value: "20",
    minCharge: "",
  });
  const [rateForm, setRateForm] = useState({
    label: "",
    commissionGstPercent: "18",
    logisticsGstPercent: "18",
    collectionChargeGstPercent: "18",
  });

  function addPartialConfig(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await savePartialPaymentConfigAction({
        label: partialForm.label,
        appliesTo: partialForm.appliesTo || undefined,
        ruleType: partialForm.ruleType,
        value: Number(partialForm.value),
        isActive: true,
        isDemo: partialForm.isDemo,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function togglePartial(config: PartialConfigRow) {
    setError(null);
    startTransition(async () => {
      const result = await togglePartialPaymentConfigAction(config.id, !config.isActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function addCollectionConfig(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveCollectionChargeConfigAction({
        label: collectionForm.label,
        chargeType: collectionForm.chargeType,
        value: Number(collectionForm.value),
        minCharge: collectionForm.minCharge ? Number(collectionForm.minCharge) : undefined,
        isActive: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleCollection(config: CollectionConfigRow) {
    setError(null);
    startTransition(async () => {
      const result = await toggleCollectionChargeConfigAction(config.id, !config.isActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function addRateConfig(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveSettlementRateConfigAction({
        label: rateForm.label,
        commissionGstPercent: Number(rateForm.commissionGstPercent),
        logisticsGstPercent: Number(rateForm.logisticsGstPercent),
        collectionChargeGstPercent: Number(rateForm.collectionChargeGstPercent),
        isActive: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleRateConfig(config: SettlementRateConfigRow) {
    setError(null);
    startTransition(async () => {
      const result = await toggleSettlementRateConfigAction(config.id, !config.isActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHeader title="Partial-payment rule" />
        <p className="text-sm text-gray-600">
          Controls how much of the order total ONLINE_PARTIAL requires upfront. The most recently
          created active rule (audience-specific first) wins.
        </p>

        {partialConfigs.length > 0 && (
          <RecordList>
            {partialConfigs.map((config) => (
              <RecordListRow key={config.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{config.label}</span>
                    <ActiveBadge active={config.isActive} />
                    {config.isDemo && <Badge tone="neutral">DEMO</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600">
                    {config.ruleType} {formatRuleValue(config.ruleType, config.value)} ·{" "}
                    {config.appliesTo ? APPLIES_TO_LABEL[config.appliesTo] : "All customer types"}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => togglePartial(config)}
                >
                  {config.isActive ? "Deactivate" : "Activate"}
                </Button>
              </RecordListRow>
            ))}
          </RecordList>
        )}

        <Card className="p-4">
          <form onSubmit={addPartialConfig} className="flex flex-wrap items-end gap-3">
            <FormInput
              label="Label"
              value={partialForm.label}
              onChange={(e) => setPartialForm((f) => ({ ...f, label: e.target.value }))}
              required
              disabled={isPending}
              className="min-w-[160px]"
            />
            <FormSelect
              label="Applies to"
              value={partialForm.appliesTo}
              onChange={(e) => setPartialForm((f) => ({ ...f, appliesTo: e.target.value }))}
              disabled={isPending}
            >
              <option value="">All customer types</option>
              <option value="CUSTOMER">Customer only</option>
              <option value="DEALER">Dealer only</option>
            </FormSelect>
            <FormSelect
              label="Rule type"
              value={partialForm.ruleType}
              onChange={(e) => setPartialForm((f) => ({ ...f, ruleType: e.target.value }))}
              disabled={isPending}
            >
              <option value="PERCENTAGE">Percentage</option>
              <option value="MIN_ADVANCE_PERCENTAGE">Minimum advance %</option>
              <option value="FIXED_AMOUNT">Fixed amount</option>
            </FormSelect>
            <FormInput
              label="Value"
              type="number"
              value={partialForm.value}
              onChange={(e) => setPartialForm((f) => ({ ...f, value: e.target.value }))}
              disabled={isPending}
              className="w-28"
            />
            <label className="flex items-center gap-1.5 pb-2.5 text-xs font-medium text-gray-600">
              <input
                type="checkbox"
                checked={partialForm.isDemo}
                onChange={(e) => setPartialForm((f) => ({ ...f, isDemo: e.target.checked }))}
              />
              Demo value
            </label>
            <Button type="submit" size="sm" loading={isPending}>
              Add rule
            </Button>
          </form>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Collection-charge configuration" />
        <p className="text-sm text-gray-600">
          Always seller-borne, computed for every seller order regardless of payment method
          (§G1/§H2).
        </p>

        {collectionConfigs.length > 0 && (
          <RecordList>
            {collectionConfigs.map((config) => (
              <RecordListRow key={config.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{config.label}</span>
                    <ActiveBadge active={config.isActive} />
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600">
                    {config.chargeType} {formatChargeValue(config.chargeType, config.value)}
                    {config.minCharge != null && ` · minimum ${formatCurrency(config.minCharge)}`}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => toggleCollection(config)}
                >
                  {config.isActive ? "Deactivate" : "Activate"}
                </Button>
              </RecordListRow>
            ))}
          </RecordList>
        )}

        <Card className="p-4">
          <form onSubmit={addCollectionConfig} className="flex flex-wrap items-end gap-3">
            <FormInput
              label="Label"
              value={collectionForm.label}
              onChange={(e) => setCollectionForm((f) => ({ ...f, label: e.target.value }))}
              required
              disabled={isPending}
              className="min-w-[160px]"
            />
            <FormSelect
              label="Charge type"
              value={collectionForm.chargeType}
              onChange={(e) => setCollectionForm((f) => ({ ...f, chargeType: e.target.value }))}
              disabled={isPending}
            >
              <option value="FLAT">Flat amount</option>
              <option value="PERCENTAGE">Percentage of subtotal</option>
            </FormSelect>
            <FormInput
              label="Value"
              type="number"
              value={collectionForm.value}
              onChange={(e) => setCollectionForm((f) => ({ ...f, value: e.target.value }))}
              disabled={isPending}
              className="w-28"
            />
            <FormInput
              label="Minimum collection charge (₹)"
              type="number"
              value={collectionForm.minCharge}
              onChange={(e) => setCollectionForm((f) => ({ ...f, minCharge: e.target.value }))}
              disabled={isPending}
              className="w-40"
            />
            <Button type="submit" size="sm" loading={isPending}>
              Add rule
            </Button>
          </form>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Settlement tax rates" />
        <p className="text-sm text-gray-600">
          Applied to seller settlements — the tax rate charged on the platform&apos;s commission, on
          the logistics charge, and on the collection charge. TCS (0.5%) and TDS (0.1%) are fixed
          statutory rates and are never editable. The most recently created active rule applies to
          every seller by default.
        </p>

        {settlementRateConfigs.length > 0 && (
          <RecordList>
            {settlementRateConfigs.map((config) => (
              <RecordListRow key={config.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{config.label}</span>
                    <ActiveBadge active={config.isActive} />
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600">
                    Commission tax {config.commissionGstPercent}% · Logistics tax{" "}
                    {config.logisticsGstPercent}% · Collection charge tax{" "}
                    {config.collectionChargeGstPercent}%
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => toggleRateConfig(config)}
                >
                  {config.isActive ? "Deactivate" : "Activate"}
                </Button>
              </RecordListRow>
            ))}
          </RecordList>
        )}

        <Card className="p-4">
          <form onSubmit={addRateConfig} className="flex flex-wrap items-end gap-3">
            <FormInput
              label="Label"
              value={rateForm.label}
              onChange={(e) => setRateForm((f) => ({ ...f, label: e.target.value }))}
              required
              disabled={isPending}
              className="min-w-[160px]"
            />
            <FormInput
              label="Commission tax rate (%)"
              type="number"
              value={rateForm.commissionGstPercent}
              onChange={(e) => setRateForm((f) => ({ ...f, commissionGstPercent: e.target.value }))}
              disabled={isPending}
              className="w-36"
            />
            <FormInput
              label="Logistics tax rate (%)"
              type="number"
              value={rateForm.logisticsGstPercent}
              onChange={(e) => setRateForm((f) => ({ ...f, logisticsGstPercent: e.target.value }))}
              disabled={isPending}
              className="w-36"
            />
            <FormInput
              label="Collection charge tax rate (%)"
              type="number"
              value={rateForm.collectionChargeGstPercent}
              onChange={(e) =>
                setRateForm((f) => ({ ...f, collectionChargeGstPercent: e.target.value }))
              }
              disabled={isPending}
              className="w-40"
            />
            <Button type="submit" size="sm" loading={isPending}>
              Add rule
            </Button>
          </form>
        </Card>
      </section>

      {error && <AlertBox tone="danger">{error}</AlertBox>}
    </div>
  );
}
