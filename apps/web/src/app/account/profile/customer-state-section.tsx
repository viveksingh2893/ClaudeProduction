"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, AlertBox } from "@kisan4u/ui";
import { ChevronDown } from "lucide-react";
import { setCustomerStateAction } from "./actions";

type StateOption = { id: string; name: string };

export function CustomerStateSection({
  currentStateName,
  states,
}: {
  currentStateName: string | null;
  states: StateOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="mb-1 text-sm font-bold text-ink">State</div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-ink">
          {currentStateName ?? <span className="text-gray-500">Not selected</span>}
        </div>
        {currentStateName ? (
          <span className="text-xs text-gray-500">Only an admin can change this now.</span>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Select state to view state-classified products
          </Button>
        )}
      </div>
      {open && <StateSelectionModal states={states} onClose={() => setOpen(false)} />}
    </div>
  );
}

function StateSelectionModal({
  states,
  onClose,
}: {
  states: StateOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<StateOption | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    if (!selected) return;
    setError(null);
    setSaving(true);
    setCustomerStateAction(selected.id)
      .then((result) => {
        setSaving(false);
        if (!result.ok) {
          setError(result.error);
          setConfirming(false);
          return;
        }
        setSaved(true);
        router.refresh();
      })
      .catch(() => {
        setSaving(false);
        setError("Something went wrong — try again.");
        setConfirming(false);
      });
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title="Select your state"
      className="max-w-md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-gray-600">
          Your selected state controls which state-specific products you can view. After saving,
          only an administrator can change it.
        </p>

        {saved ? (
          <>
            <AlertBox tone="success">State saved. This page will refresh shortly.</AlertBox>
          </>
        ) : confirming ? (
          <>
            <div className="rounded-lg border border-border bg-bg-dashboard p-3 text-[13px] text-ink">
              You selected <span className="font-bold">{selected?.name}</span>. Once saved, you
              will not be able to change it yourself — only an administrator can change it after
              this. Continue?
            </div>
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex gap-2">
              <Button type="button" loading={saving} onClick={handleSave}>
                Confirm and save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Back
              </Button>
            </div>
          </>
        ) : (
          <>
            <StateSingleSelect states={states} value={selected} onChange={setSelected} />
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex gap-2">
              <Button type="button" disabled={!selected} onClick={() => setConfirming(true)}>
                Continue
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Same searchable single-select combobox pattern used for the seller/admin
 * licence forms' state picker (apps/dashboard) — duplicated here rather
 * than shared across apps/web and apps/dashboard, since the two apps don't
 * share a components package and this is a small, self-contained piece of
 * UI logic (same rationale as this session's date-formatting duplication
 * across package boundaries).
 */
function StateSingleSelect({
  states,
  value,
  onChange,
}: {
  states: StateOption[];
  value: StateOption | null;
  onChange: (state: StateOption) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => states.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
    [states, query],
  );

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={dropdownOpen}
        aria-label="State"
        onClick={() => setDropdownOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-green-600"
      >
        <span className={value ? "text-ink" : "text-gray-500"}>
          {value ? value.name : "Select a state…"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
      {dropdownOpen && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-surface shadow-lift">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search states…"
            aria-label="Search states"
            className="w-full border-b border-border px-3 py-2 text-[13px] outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDropdownOpen(false);
                setQuery("");
              }
              if (e.key === "Enter" && filtered.length === 1 && filtered[0]) {
                onChange(filtered[0]);
                setDropdownOpen(false);
                setQuery("");
              }
            }}
          />
          <ul role="listbox" className="max-h-[220px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[13px] text-gray-500">No states match.</li>
            )}
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s.id === value?.id}
                  onClick={() => {
                    onChange(s);
                    setDropdownOpen(false);
                    setQuery("");
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-bg-dashboard focus:outline-none focus:bg-bg-dashboard ${
                    s.id === value?.id ? "bg-green-50 font-semibold text-green-700" : "text-ink"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
