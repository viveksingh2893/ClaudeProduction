"use client";

import { useRouter } from "next/navigation";

/**
 * Payout-cycle picker for the admin Settlements page. Navigates to
 * ?cycle=<key> (server component re-reads it and re-queries) rather than
 * holding any client state — the selected cycle is the URL.
 */
export function CycleFilter({
  options,
  value,
}: {
  options: { value: string; label: string }[];
  value: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-gray-600">Payout date</span>
      <select
        value={value}
        onChange={(e) => router.push(`/admin/settlements?cycle=${e.target.value}`)}
        className="rounded-md border-[1.5px] border-border bg-white px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-green-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
