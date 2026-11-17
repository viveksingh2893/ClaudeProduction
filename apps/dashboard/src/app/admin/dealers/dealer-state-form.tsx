"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@kisan4u/ui";
import { setDealerStateAction } from "./actions";

export function DealerStateForm({
  profileId,
  currentStateId,
  states,
}: {
  profileId: string;
  currentStateId: string | null;
  states: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [stateId, setStateId] = useState(currentStateId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!stateId || stateId === currentStateId) return;
    setError(null);
    startTransition(async () => {
      const result = await setDealerStateAction(profileId, stateId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <select
          value={stateId}
          onChange={(e) => setStateId(e.target.value)}
          aria-label="Dealer state"
          className="rounded-md border-[1.5px] border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-green-600"
        >
          <option value="">— No state —</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" onClick={handleSave} loading={isPending} disabled={!stateId || stateId === currentStateId}>
          Save
        </Button>
      </div>
      {error && (
        <span role="alert" className="text-[11px] font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
