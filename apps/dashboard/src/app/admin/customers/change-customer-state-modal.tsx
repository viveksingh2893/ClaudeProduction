"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertBox, Button, FormTextarea, Modal } from "@kisan4u/ui";
import { ChevronDown } from "lucide-react";
import { adminChangeCustomerStateAction } from "./actions";

type StateOption = { id: string; name: string };

/**
 * Spec §1 — admin "Change customer state" action: searchable single-state
 * dropdown, confirmation, reason required, audit log (written server-side
 * by adminChangeCustomerState). Authorization (requireSession(ADMIN) +
 * module-permission check) happens in the server action itself, never
 * trusted from this component alone — this modal only surfaces whatever
 * error the action returns (e.g. "not permitted") the same way any other
 * validation error is shown.
 */
export function ChangeCustomerStateModal({
  customerId,
  customerName,
  currentStateName,
  states,
  onClose,
}: {
  customerId: string;
  customerName: string;
  currentStateName: string | null;
  states: StateOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<StateOption | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    if (!selected || !reason.trim()) return;
    setError(null);
    setSaving(true);
    adminChangeCustomerStateAction(customerId, selected.id, reason.trim())
      .then((result) => {
        setSaving(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
      })
      .catch(() => {
        setSaving(false);
        setError("Something went wrong — try again.");
      });
  }

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title={`Change state — ${customerName}`}
      className="max-w-md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-gray-600">
          Current state:{" "}
          <span className="font-semibold text-ink">{currentStateName ?? "Not selected"}</span>
        </p>

        {saved ? (
          <AlertBox tone="success">Customer state updated.</AlertBox>
        ) : confirming ? (
          <>
            <div className="rounded-lg border border-border bg-bg-dashboard p-3 text-[13px] text-ink">
              Change {customerName}&apos;s state from{" "}
              <span className="font-semibold">{currentStateName ?? "Not selected"}</span> to{" "}
              <span className="font-semibold">{selected?.name}</span>? This is recorded in the
              audit log with your reason below.
            </div>
            <div className="rounded-lg border border-border p-3 text-[13px] text-gray-600">
              Reason: {reason}
            </div>
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex gap-2">
              <Button type="button" loading={saving} onClick={handleSave}>
                Confirm change
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
            <FormTextarea
              label="Reason for change"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
            />
            {error && <AlertBox tone="danger">{error}</AlertBox>}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={!selected || !reason.trim()}
                onClick={() => setConfirming(true)}
              >
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

function StateSingleSelect({
  states,
  value,
  onChange,
}: {
  states: StateOption[];
  value: StateOption | null;
  onChange: (state: StateOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => states.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
    [states, query],
  );

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div>
      <span className="mb-1 block text-[13px] font-semibold text-ink">New state</span>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="New state"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-green-600"
        >
          <span className={value ? "text-ink" : "text-gray-500"}>
            {value ? value.name : "Select a state…"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        </button>
        {open && (
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
                  setOpen(false);
                  setQuery("");
                }
                if (e.key === "Enter" && filtered.length === 1 && filtered[0]) {
                  onChange(filtered[0]);
                  setOpen(false);
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
                      setOpen(false);
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
    </div>
  );
}
