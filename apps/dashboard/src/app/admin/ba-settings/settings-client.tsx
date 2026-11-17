"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveBaSettingsAction,
  saveBaRateConfigAction,
  toggleBaRateConfigAction,
  toggleBaProgramAction,
} from "./actions";

type Settings = {
  registrationAmount: number;
  dealerSignupAmount: number;
  dealerApprovalAmount: number;
  defaultCommissionPercent: number;
  returnWindowHours: number;
};
type RateConfig = {
  id: string;
  label: string;
  sellerId: string | null;
  sellerName: string | null;
  customerType: string | null;
  commissionPercent: number;
  isActive: boolean;
};

export function BaSettingsClient({
  enabled,
  settings,
  rateConfigs,
  sellers,
}: {
  enabled: boolean;
  settings: Settings;
  rateConfigs: RateConfig[];
  sellers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [newRate, setNewRate] = useState({
    label: "",
    sellerId: "",
    customerType: "",
    commissionPercent: settings.defaultCommissionPercent,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? "Saved." : r.error ?? "Failed");
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-gray-100 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Program status</div>
            <div className="text-xs text-gray-500">
              When off, the customer-facing “Become a BA” entry points are hidden.
            </div>
          </div>
          <button
            disabled={pending}
            onClick={() => run(() => toggleBaProgramAction(!enabled))}
            className={`rounded px-4 py-2 text-sm font-semibold text-white ${
              enabled ? "bg-red-600" : "bg-green-700"
            }`}
          >
            {enabled ? "Turn OFF" : "Turn ON"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-gray-100 p-5">
        <div className="mb-3 text-sm font-semibold">Flat amounts</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(
            [
              ["registrationAmount", "Registration ₹"],
              ["dealerSignupAmount", "Dealer signup ₹"],
              ["dealerApprovalAmount", "Dealer approval ₹"],
              ["defaultCommissionPercent", "Default commission %"],
              ["returnWindowHours", "Return window (hours)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="text-xs">
              <span className="text-gray-500">{label}</span>
              <input
                type="number"
                step="0.01"
                value={form[k]}
                onChange={(e) => setForm((s) => ({ ...s, [k]: Number(e.target.value) }))}
                className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
        <button
          disabled={pending}
          onClick={() => run(() => saveBaSettingsAction(form))}
          className="mt-3 rounded bg-green-700 px-4 py-1.5 text-xs font-semibold text-white"
        >
          Save amounts
        </button>
      </section>

      <section className="rounded-lg border border-gray-100 p-5">
        <div className="mb-3 text-sm font-semibold">Per-seller / per-customer-type commission</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1">Label</th>
              <th className="py-1">Seller</th>
              <th className="py-1">Buyer</th>
              <th className="py-1 text-right">%</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rateConfigs.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-1.5">{c.label}</td>
                <td className="py-1.5">{c.sellerName ?? "All sellers"}</td>
                <td className="py-1.5">{c.customerType ?? "All"}</td>
                <td className="py-1.5 text-right">{c.commissionPercent}</td>
                <td className="py-1.5 text-right">
                  <button
                    disabled={pending}
                    onClick={() => run(() => toggleBaRateConfigAction(c.id, !c.isActive))}
                    className="text-xs text-green-700"
                  >
                    {c.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input
            placeholder="Label"
            value={newRate.label}
            onChange={(e) => setNewRate((s) => ({ ...s, label: e.target.value }))}
            className="rounded border border-border px-2 py-1 text-sm"
          />
          <select
            value={newRate.sellerId}
            onChange={(e) => setNewRate((s) => ({ ...s, sellerId: e.target.value }))}
            className="rounded border border-border px-2 py-1 text-sm"
          >
            <option value="">All sellers</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={newRate.customerType}
            onChange={(e) => setNewRate((s) => ({ ...s, customerType: e.target.value }))}
            className="rounded border border-border px-2 py-1 text-sm"
          >
            <option value="">All buyers</option>
            <option value="CUSTOMER">Customer</option>
            <option value="DEALER">Dealer</option>
          </select>
          <input
            type="number"
            step="0.01"
            value={newRate.commissionPercent}
            onChange={(e) => setNewRate((s) => ({ ...s, commissionPercent: Number(e.target.value) }))}
            className="rounded border border-border px-2 py-1 text-sm"
          />
        </div>
        <button
          disabled={pending || !newRate.label}
          onClick={() =>
            run(() =>
              saveBaRateConfigAction({
                label: newRate.label,
                sellerId: newRate.sellerId || null,
                customerType: (newRate.customerType || null) as never,
                commissionPercent: newRate.commissionPercent,
                isActive: true,
              }),
            )
          }
          className="mt-2 rounded bg-green-700 px-4 py-1.5 text-xs font-semibold text-white"
        >
          Add rate
        </button>
      </section>

      {msg && <p className="text-xs text-gray-600">{msg}</p>}
    </div>
  );
}
