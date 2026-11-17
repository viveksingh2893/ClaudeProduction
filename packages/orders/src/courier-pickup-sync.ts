import { prisma, type SellerPickupPoint } from "@kisan4u/db";
import {
  configuredDelhiveryAccounts,
  delhiveryRegisterWarehouse,
  rapidshypCreatePickupLocation,
  type DelhiveryAccountKey,
} from "@kisan4u/providers";

/**
 * Keeps each SellerPickupPoint registered as a pickup location on both
 * couriers — a Delhivery client warehouse (on every configured Delhivery
 * account) and a RapidShyp pickup location — under one shared name.
 *
 * Neither courier exposes a usable "edit pickup location" API (RapidShyp's
 * is undocumented / "Coming Soon", and the Delhivery integration only uses
 * create), so an address change on an already-registered point bumps
 * `courierAddressRevision` and the new address is registered under a new
 * name (K4U-<id>-r<n>). Shipments already booked keep the old location;
 * everything booked afterwards uses the new one.
 *
 * Registration runs eagerly on approval / admin edit (syncPickupPointToCouriers)
 * and lazily at dispatch or return time (ensure* below) if the eager
 * attempt failed, so a courier outage at approval time never blocks
 * dispatch later.
 */

const FALLBACK_CONTACT_EMAIL = "care@kisan4u.com";

/** Courier-side location name for a pickup point at a given address revision. Revision 0 keeps the original `K4U-<id>` names already registered on Delhivery. */
export function courierLocationNameFor(pickupPointId: string, revision = 0): string {
  return revision > 0 ? `K4U-${pickupPointId}-r${revision}` : `K4U-${pickupPointId}`;
}

/**
 * RapidShyp caps a pickup-location name at 20 characters ("Address
 * Name(Address Tag) should be only max 20 characters long"), so it gets a
 * shorter name than Delhivery: the last 10 chars of the cuid (unique across
 * pickup points — they're the cuid's fingerprint + random part).
 */
export function rapidshypLocationNameFor(pickupPointId: string, revision = 0): string {
  const base = `K4U-${pickupPointId.slice(-10)}`;
  return revision > 0 ? `${base}-r${revision}` : base;
}

export type PickupPointForSync = Pick<
  SellerPickupPoint,
  | "id"
  | "sellerId"
  | "contactPerson"
  | "mobile"
  | "line1"
  | "landmark"
  | "city"
  | "state"
  | "pincode"
  | "courierAddressRevision"
  | "rapidshypPickupName"
  | "rapidshypSyncedRevision"
  | "delhiveryWarehouseName"
  | "delhiverySyncedRevision"
>;

/** Address/contact fields whose change means the courier-side location is stale. */
export const COURIER_ADDRESS_FIELDS = [
  "contactPerson",
  "mobile",
  "line1",
  "landmark",
  "city",
  "district",
  "state",
  "pincode",
] as const;

export function courierAddressChanged(
  before: Record<(typeof COURIER_ADDRESS_FIELDS)[number], string | null>,
  after: Partial<Record<(typeof COURIER_ADDRESS_FIELDS)[number], string | null | undefined>>,
): boolean {
  return COURIER_ADDRESS_FIELDS.some((f) => (before[f] ?? null) !== (after[f] ?? null));
}

/** True once the point has been registered with either courier, i.e. an address edit must go out as a new revision. */
export function isRegisteredWithAnyCourier(point: {
  delhiveryWarehouseName: string | null;
  rapidshypPickupName: string | null;
}): boolean {
  return !!point.delhiveryWarehouseName || !!point.rapidshypPickupName;
}

export function pickupAddressText(point: { line1: string; landmark: string | null }): string {
  return [point.line1, point.landmark]
    .filter(Boolean)
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits an address across RapidShyp's two 100-char address lines,
 * breaking at a comma or space. Anything past 200 chars is dropped (the
 * pincode still pins the locality); `truncated` reports that.
 */
export function splitAddressForRapidShyp(text: string): {
  line1: string;
  line2?: string;
  truncated: boolean;
} {
  const MAX = 100;
  const cut = (s: string): [string, string] => {
    if (s.length <= MAX) return [s, ""];
    const window = s.slice(0, MAX + 1);
    const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
    const idx = at >= 3 ? at : MAX;
    return [s.slice(0, idx).replace(/[,\s]+$/, ""), s.slice(idx).replace(/^[,\s]+/, "")];
  };
  const [line1, rest] = cut(text);
  const [line2, overflow] = cut(rest);
  return {
    line1,
    ...(line2.length >= 3 ? { line2 } : {}),
    truncated: overflow.length > 0,
  };
}

/** RapidShyp accepts alphabets only in contact_name. */
export function sanitizeRapidShypContactName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Kisan4U";
}

export function tenDigitMobile(mobile: string): string {
  return mobile.replace(/\D/g, "").slice(-10);
}

export function rapidshypPickupLocationPayload(
  point: PickupPointForSync,
  name: string,
  email: string | null | undefined,
) {
  const address = splitAddressForRapidShyp(pickupAddressText(point));
  return {
    name,
    contactName: sanitizeRapidShypContactName(point.contactPerson),
    contactNumber: tenDigitMobile(point.mobile),
    email: email?.trim() || FALLBACK_CONTACT_EMAIL,
    addressLine: address.line1,
    ...(address.line2 ? { addressLine2: address.line2 } : {}),
    pincode: point.pincode,
    truncated: address.truncated,
  };
}

export type EnsureLocationResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * The RapidShyp pickup-location name to dispatch this point from,
 * registering it first if it isn't registered at the current address
 * revision. No API call when it already is.
 */
export async function ensureRapidShypPickupLocation(
  point: PickupPointForSync,
): Promise<EnsureLocationResult> {
  const revision = point.courierAddressRevision;
  if (point.rapidshypPickupName && point.rapidshypSyncedRevision === revision) {
    return { ok: true, name: point.rapidshypPickupName };
  }
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: point.sellerId },
    select: { contactEmail: true },
  });
  const { truncated: _truncated, ...payload } = rapidshypPickupLocationPayload(
    point,
    rapidshypLocationNameFor(point.id, revision),
    seller?.contactEmail,
  );
  const created = await rapidshypCreatePickupLocation(payload);
  if (!created.ok) return { ok: false, error: created.error };
  await prisma.sellerPickupPoint.update({
    where: { id: point.id },
    data: { rapidshypPickupName: created.data.name, rapidshypSyncedRevision: revision },
  });
  return { ok: true, name: created.data.name };
}

/**
 * Registers (idempotently — Delhivery answers "already exists" for a known
 * name) this point's current-revision warehouse on one Delhivery account
 * and returns its name. Always calls Delhivery: a warehouse registered on
 * one account isn't known to the others, and the DB only records that it
 * succeeded on at least one.
 */
export async function ensureDelhiveryWarehouse(
  account: DelhiveryAccountKey,
  point: PickupPointForSync,
  opts: { useKnownNameOnFailure?: boolean } = {},
): Promise<EnsureLocationResult> {
  const revision = point.courierAddressRevision;
  const name = courierLocationNameFor(point.id, revision);
  const address = pickupAddressText(point);
  const registered = await delhiveryRegisterWarehouse(account, {
    name,
    phone: point.mobile,
    address,
    city: point.city,
    pin: point.pincode,
    state: point.state,
    returnAddress: address,
    returnCity: point.city,
    returnPin: point.pincode,
    returnState: point.state,
  });
  if (!registered.ok) {
    // Already registered at this revision (on at least one account, and
    // normally all of them via the approval-time sync): go ahead with the
    // known name rather than blocking dispatch on a flaky/throttled
    // registration call — Delhivery's own create.json rejects the shipment
    // if the warehouse really is unknown on this account.
    // (The name encodes the revision, so a match means this exact address.)
    if (opts.useKnownNameOnFailure && point.delhiveryWarehouseName === name) {
      console.warn(`[delhivery] warehouse re-registration failed for ${name} on ${account}, using it anyway: ${registered.error}`);
      return { ok: true, name };
    }
    return { ok: false, error: registered.error };
  }
  if (point.delhiveryWarehouseName !== name || point.delhiverySyncedRevision !== revision) {
    await prisma.sellerPickupPoint.update({
      where: { id: point.id },
      data: { delhiveryWarehouseName: name, delhiverySyncedRevision: revision },
    });
  }
  return { ok: true, name };
}

export type CourierSyncResult = {
  rapidshyp: EnsureLocationResult;
  delhivery: { account: DelhiveryAccountKey; result: EnsureLocationResult }[];
  /** Human-readable summary of any failures, or undefined when everything registered. */
  warning?: string;
};

/**
 * Registers a pickup point on RapidShyp and on every configured Delhivery
 * account at its current address revision. Never throws on a courier
 * failure — failures are summarised in `warning` and stored in
 * `courierSyncError` for the admin pickup points page, and dispatch
 * retries them lazily.
 */
export async function syncPickupPointToCouriers(pickupPointId: string): Promise<CourierSyncResult> {
  const point = await prisma.sellerPickupPoint.findUniqueOrThrow({ where: { id: pickupPointId } });

  const rapidshyp = await ensureRapidShypPickupLocation(point).catch(
    (e: unknown): EnsureLocationResult => ({ ok: false, error: String((e as Error)?.message ?? e) }),
  );

  const delhivery: CourierSyncResult["delhivery"] = [];
  for (const account of configuredDelhiveryAccounts()) {
    // Re-read so a name stored by an earlier account's success isn't rewritten.
    const current = await prisma.sellerPickupPoint.findUniqueOrThrow({ where: { id: pickupPointId } });
    const result = await ensureDelhiveryWarehouse(account, current).catch(
      (e: unknown): EnsureLocationResult => ({ ok: false, error: String((e as Error)?.message ?? e) }),
    );
    delhivery.push({ account, result });
  }

  const failures: string[] = [];
  if (!rapidshyp.ok) failures.push(`RapidShyp: ${rapidshyp.error}`);
  for (const d of delhivery) {
    if (!d.result.ok) failures.push(`Delhivery ${d.account}: ${d.result.error}`);
  }
  const warning = failures.length
    ? `Courier pickup-location registration failed — ${failures.join("; ")}. It will be retried on the next dispatch, or use "Sync to couriers".`
    : undefined;

  await prisma.sellerPickupPoint.update({
    where: { id: pickupPointId },
    data: { courierSyncError: failures.length ? failures.join("; ") : null },
  });

  return { rapidshyp, delhivery, ...(warning ? { warning } : {}) };
}
