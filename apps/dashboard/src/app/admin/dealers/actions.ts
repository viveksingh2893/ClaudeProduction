"use server";

import { setDealerState } from "@kisan4u/auth";
import { requireSession } from "@/lib/session-guard";

type Result = { ok: true } | { ok: false; error: string };

/** Admin-only — dealers cannot change their own state once registered (see requirement 7); only this action can. */
export async function setDealerStateAction(profileId: string, stateId: string): Promise<Result> {
  await requireSession(["ADMIN"]);
  return setDealerState(profileId, stateId);
}
