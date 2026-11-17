"use client";

import { useState } from "react";
import { Card, FormSelect } from "@kisan4u/ui";

type StateEligibility = {
  customerAvailable: boolean;
  customerReasons: string[];
  dealerAvailable: boolean;
  dealerReasons: string[];
};

/**
 * Spec §9 "evaluated eligibility for the selected state" — purely
 * presentational; the actual eligibility/explainBlockedState computation
 * happens server-side in page.tsx and is passed down as a plain lookup
 * table, so this component never needs to import licence-eligibility.ts
 * (a server-only module backed by @kisan4u/db) into the client bundle.
 */
export function StateEligibilityChecker({
  states,
  byStateId,
}: {
  states: { id: string; name: string }[];
  byStateId: Record<string, StateEligibility>;
}) {
  const [stateId, setStateId] = useState(states[0]?.id ?? "");
  const result = byStateId[stateId];

  return (
    <Card className="p-4 text-sm">
      <div className="mb-2 text-[13px] font-bold text-ink">
        Check eligibility for a specific state
      </div>
      <div className="max-w-xs">
        <FormSelect
          label=""
          aria-label="State"
          value={stateId}
          onChange={(e) => setStateId(e.target.value)}
        >
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FormSelect>
      </div>
      {result && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="flex-1 rounded-lg border border-border p-3">
            <div className="text-[13px] font-semibold text-ink">Customer</div>
            <div
              className={
                result.customerAvailable ? "text-[13px] text-success" : "text-[13px] text-danger"
              }
            >
              {result.customerAvailable ? "Available" : "Blocked"}
            </div>
            {result.customerReasons.map((r, i) => (
              <div key={i} className="mt-0.5 text-[12px] text-gray-600">
                {r}
              </div>
            ))}
          </div>
          <div className="flex-1 rounded-lg border border-border p-3">
            <div className="text-[13px] font-semibold text-ink">Dealer</div>
            <div
              className={
                result.dealerAvailable ? "text-[13px] text-success" : "text-[13px] text-danger"
              }
            >
              {result.dealerAvailable ? "Available" : "Blocked"}
            </div>
            {result.dealerReasons.map((r, i) => (
              <div key={i} className="mt-0.5 text-[12px] text-gray-600">
                {r}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
