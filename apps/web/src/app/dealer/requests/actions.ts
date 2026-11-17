"use server";

import { getDealerProfileForUser } from "@kisan4u/auth";
import { createProductRequest, cancelProductRequestAsDealer } from "@kisan4u/catalog";
import { notifyAllAdmins } from "@kisan4u/orders";
import { productRequestInputSchema } from "@kisan4u/validators";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";

type Result =
  { ok: true; requestId: string; publicRequestNumber: string } | { ok: false; error: string };
type SimpleResult = { ok: true } | { ok: false; error: string };

async function requireApprovedDealerProfile() {
  const session = await requireSession(["DEALER"]);
  const profile = await getDealerProfileForUser(session.user.id);
  if (!profile || profile.status !== "APPROVED") redirect("/dealer/status");
  return profile;
}

/**
 * "Request Seller" — an enquiry only. dealerId always comes from the
 * session-derived profile above, never from client input; sellerId is
 * re-derived server-side from the product row (see
 * packages/catalog/src/product-requests.ts), and every other field
 * (product visibility, variant ownership/activeness, delivery-state
 * availability) is re-validated there too — the form's prefilled values
 * are a UX convenience, never trusted as-is.
 */
export async function createProductRequestAction(rawInput: unknown): Promise<Result> {
  const profile = await requireApprovedDealerProfile();
  const parsed = productRequestInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const result = await createProductRequest(profile.id, parsed.data);
  if (result.ok) {
    await notifyAllAdmins({
      title: "New product request awaiting review",
      body: `Request ${result.publicRequestNumber} needs review before it can be forwarded to the seller.`,
    });
  }
  return result;
}

export async function cancelProductRequestAction(requestId: string): Promise<SimpleResult> {
  const profile = await requireApprovedDealerProfile();
  return cancelProductRequestAsDealer(profile.id, requestId);
}
