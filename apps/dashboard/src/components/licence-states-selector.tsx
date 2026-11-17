"use client";

import { useState } from "react";
import { AlertBox, Button } from "@kisan4u/ui";
import { Check, X } from "lucide-react";
import type {
  SellingLicenceEligibilityResult,
  RequirementEligibility,
  RequirementLegStatus,
} from "@kisan4u/catalog";

export type StateOption = { id: string; name: string };

function legStatusLabel(status: RequirementLegStatus): string {
  switch (status) {
    case "MISSING":
      return "not submitted";
    case "PENDING_APPROVAL":
      return "pending approval";
    case "REJECTED":
      return "rejected";
    case "EXPIRED":
      return "expired";
    case "REVOKED":
      return "revoked";
    case "APPROVED":
      return "approved";
    case "NOT_APPLICABLE":
      return "not applicable";
  }
}

function RequirementList({
  requirements,
  audience,
}: {
  requirements: RequirementEligibility[];
  audience: "customer" | "dealer";
}) {
  const applicable = requirements.filter((r) =>
    audience === "customer" ? r.customer.required : r.dealer.required,
  );
  if (applicable.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {applicable.map((r) => {
        const leg = audience === "customer" ? r.customer : r.dealer;
        return (
          <li key={r.requirementId} className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-ink">{r.name}</span>
            <span className="text-gray-500">
              (
              {r.source === "CATEGORY"
                ? "inherited from category"
                : r.source === "SUBCATEGORY"
                  ? "inherited from subcategory"
                  : "direct requirement"}{" "}
              · {leg.geoType === "PAN_INDIA" ? "Pan India" : "state-wise"})
            </span>
            <span
              className={
                leg.status === "APPROVED"
                  ? "font-semibold text-success"
                  : "font-semibold text-danger"
              }
            >
              {legStatusLabel(leg.status)}
            </span>
            {leg.reason && <span className="text-gray-500">— {leg.reason}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Customer/Dealer state-availability picker, licence-eligibility aware
 * (selling-licence module spec §6). `eligibility` is null before it has
 * loaded (or for an in-house product with no owning seller) — in that
 * state every state is shown as eligible with no restriction, matching
 * pre-module behavior exactly, so a product outside any regulated taxonomy
 * path is never artificially blocked while the fetch is in flight.
 */
export function LicenceStatesSelector({
  audienceLabel,
  audience,
  states,
  value,
  onChange,
  eligibility,
}: {
  audienceLabel: string;
  audience: "customer" | "dealer";
  states: StateOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  eligibility: SellingLicenceEligibilityResult | null;
}) {
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [showRequirements, setShowRequirements] = useState(false);

  const audienceResult = eligibility
    ? audience === "customer"
      ? eligibility.customer
      : eligibility.dealer
    : null;
  const eligibleSet = audienceResult ? new Set(audienceResult.eligibleStateIds) : null;
  const isPanIndia = audienceResult ? audienceResult.isPanIndia : true;
  const fullyBlocked = audienceResult ? audienceResult.blockingRequirements.length > 0 : false;

  function toggleState(id: string) {
    setBlockedError(null);
    if (eligibleSet && !eligibleSet.has(id)) {
      const state = states.find((s) => s.id === id);
      setBlockedError(
        `You cannot sell this product to ${audience === "customer" ? "Customers" : "Dealers"} in ${state?.name ?? "this state"} because ${
          audienceResult && audienceResult.blockingRequirements.length > 0
            ? `"${audienceResult.blockingRequirements[0]!.name}" is ${legStatusLabel(audienceResult.blockingRequirements[0]!.status)}`
            : "the approved licence does not cover this state"
        }.`,
      );
      return;
    }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function selectWhereverApplicable() {
    setBlockedError(null);
    onChange(eligibleSet ? [...eligibleSet] : states.map((s) => s.id));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-ink">{audienceLabel}</h3>
        <Button type="button" variant="outline" size="sm" onClick={selectWhereverApplicable}>
          Select wherever applicable
        </Button>
      </div>

      {eligibility && (
        <p className="text-[13px] text-gray-600">
          {fullyBlocked
            ? `Blocked — ${audienceResult!.blockingRequirements.map((b) => `"${b.name}" is ${legStatusLabel(b.status)}`).join(", ")}.`
            : isPanIndia
              ? "Approved for all states."
              : `Approved for ${audienceResult!.eligibleStateIds.length} state${audienceResult!.eligibleStateIds.length === 1 ? "" : "s"}.`}
          {eligibility.requirements.some((r) =>
            audience === "customer" ? r.customer.required : r.dealer.required,
          ) && (
            <button
              type="button"
              className="ml-2 font-semibold text-green-700 hover:underline"
              onClick={() => setShowRequirements((s) => !s)}
            >
              {showRequirements ? "Hide required licences" : "View required licences"}
            </button>
          )}
        </p>
      )}
      {showRequirements && eligibility && (
        <div className="rounded-lg border border-border bg-bg-dashboard p-3">
          <RequirementList requirements={eligibility.requirements} audience={audience} />
        </div>
      )}

      {blockedError && <AlertBox tone="danger">{blockedError}</AlertBox>}

      <div className="grid max-h-[260px] grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
        {states.map((s) => {
          const eligible = eligibleSet === null || eligibleSet.has(s.id);
          const selected = value.includes(s.id);
          return (
            <label
              key={s.id}
              className={`flex items-center gap-2 rounded px-2 py-1 text-[13px] ${eligible ? "cursor-pointer text-ink" : "cursor-not-allowed text-gray-400"}`}
              onClick={(e) => {
                if (!eligible) {
                  e.preventDefault();
                  toggleState(s.id);
                }
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                readOnly={!eligible}
                onChange={() => toggleState(s.id)}
              />
              {s.name}
              {eligible ? (
                <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              ) : (
                <X className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
