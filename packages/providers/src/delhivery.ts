/**
 * Delhivery (direct single-carrier) integration — the second real
 * third-party courier in this codebase after rapidshyp.ts. Unlike
 * RapidShyp (a multi-courier aggregator with a create -> approve ->
 * assign-AWB -> label sequence), Delhivery is one carrier: a single
 * `cmu/create.json` call manifests the shipment AND returns the waybill,
 * then one call fetches the label. There is no courier selection and no
 * separate AWB-assignment step.
 *
 * Multi-account: Kisan4U has THREE Delhivery accounts, each with its own
 * API token. Every call takes a `DelhiveryAccountKey` and the token is
 * resolved from that account's env var. A shipment is created against one
 * account and every later call for it (label, track, cancel) MUST use the
 * same account — the waybill only exists on that account.
 *
 * Auth: `Authorization: Token <token>` on every request. Base URL:
 * https://track.delhivery.com (production). Docs:
 * https://one.delhivery.com/developer-portal/documents/b2c/
 *
 * Pickup is handled by account-level auto-pickup on the Delhivery side
 * (One Panel setting) — this client deliberately does NOT call the
 * pickup-request API, matching how rapidshyp-shipping.ts leaves pickup
 * scheduling to the provider.
 */

const DELHIVERY_BASE_URL = "https://track.delhivery.com";

export type DelhiveryAccountKey = "MARKETING1" | "SURFACE_500G" | "SURFACE_1";

/** key -> env var holding that account's API token. */
const DELHIVERY_ACCOUNT_ENV: Record<DelhiveryAccountKey, string> = {
  MARKETING1: "DELHIVERY_TOKEN_MARKETING1",
  SURFACE_500G: "DELHIVERY_TOKEN_500G",
  SURFACE_1: "DELHIVERY_TOKEN_1",
};

function delhiveryToken(account: DelhiveryAccountKey): string {
  const fromEnv = process.env[DELHIVERY_ACCOUNT_ENV[account]];
  // Back-compat: the first account was integrated as DELHIVERY_API_TOKEN.
  const legacy = account === "MARKETING1" ? process.env.DELHIVERY_API_TOKEN : undefined;
  const token = fromEnv || legacy;
  if (!token) throw new Error(`Delhivery token not configured for account "${account}".`);
  return token;
}

/** The account keys that actually have a token configured. */
export function configuredDelhiveryAccounts(): DelhiveryAccountKey[] {
  return (Object.keys(DELHIVERY_ACCOUNT_ENV) as DelhiveryAccountKey[]).filter((k) => {
    const legacy = k === "MARKETING1" ? process.env.DELHIVERY_API_TOKEN : undefined;
    return !!(process.env[DELHIVERY_ACCOUNT_ENV[k]] || legacy);
  });
}

export type DelhiveryResult<T> =
  | { ok: true; data: T; raw: unknown }
  | { ok: false; error: string; raw: unknown };

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Delhivery wants a bare 10-digit mobile — strip +91 / spaces / punctuation. */
function normalizePhone(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

async function delhiveryRequest(
  account: DelhiveryAccountKey,
  path: string,
  method: "GET" | "POST",
  body?: { json?: unknown; form?: Record<string, string> },
): Promise<{ raw: unknown; httpOk: boolean; status: number }> {
  const headers: Record<string, string> = {
    Authorization: `Token ${delhiveryToken(account)}`,
    Accept: "application/json",
  };
  let payload: string | undefined;
  if (body?.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    // URLSearchParams percent-encodes the whole `data` value, which is
    // exactly what Delhivery's docs mean by "use URL-encoded payloads" —
    // it keeps a `&`/`#`/`%`/`;`/`\` inside an address from breaking the
    // form-body parsing on their side.
    payload = new URLSearchParams(body.form).toString();
  } else if (body?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body.json);
  }
  let res: Response;
  try {
    res = await fetch(`${DELHIVERY_BASE_URL}${path}`, { method, headers, body: payload });
  } catch {
    return { raw: null, httpOk: false, status: 0 };
  }
  const raw = await res.json().catch(() => null);
  return { raw, httpOk: res.ok, status: res.status };
}

// --- Pincode serviceability -----------------------------------------------

export interface DelhiveryServiceability {
  /** blank remark = serviceable; "Embargo" = temporary NSZ; missing = NSZ */
  serviceable: boolean;
  embargo: boolean;
  cod: boolean;
  prepaid: boolean;
  remarks: string;
}

export async function delhiveryCheckServiceability(
  account: DelhiveryAccountKey,
  pincode: string,
): Promise<DelhiveryResult<DelhiveryServiceability>> {
  const { raw, httpOk } = await delhiveryRequest(
    account,
    `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`,
    "GET",
  );
  if (!httpOk) return { ok: false, error: "Delhivery serviceability request failed.", raw };
  const r = (raw ?? {}) as Record<string, unknown>;
  const codes = Array.isArray(r.delivery_codes)
    ? (r.delivery_codes as Record<string, unknown>[])
    : [];
  const pc = codes[0]?.postal_code as Record<string, unknown> | undefined;
  if (!pc) {
    return {
      ok: true,
      data: {
        serviceable: false,
        embargo: false,
        cod: false,
        prepaid: false,
        remarks: "Not serviceable (NSZ)",
      },
      raw,
    };
  }
  const remarks = (asString(pc.remarks) ?? "").trim();
  const embargo = remarks.toLowerCase().includes("embargo");
  return {
    ok: true,
    data: {
      serviceable: remarks.length === 0,
      embargo,
      cod: pc.cod === "Y",
      prepaid: pc.pre_paid === "Y",
      remarks: remarks || "Serviceable",
    },
    raw,
  };
}

// --- Client warehouse (pickup location) ----------------------------------

export interface DelhiveryWarehouseInput {
  /** Case/space-sensitive; must match `pickup_location.name` in create.json exactly. */
  name: string;
  registeredName?: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  pin: string;
  state?: string;
  returnAddress: string;
  returnCity?: string;
  returnPin: string;
  returnState?: string;
}

export async function delhiveryRegisterWarehouse(
  account: DelhiveryAccountKey,
  input: DelhiveryWarehouseInput,
): Promise<DelhiveryResult<{ name: string }>> {
  const { raw, httpOk, status } = await delhiveryRequest(
    account,
    "/api/backend/clientwarehouse/create/",
    "POST",
    {
      json: {
        name: input.name,
        registered_name: input.registeredName,
        phone: normalizePhone(input.phone),
        email: input.email,
        address: input.address,
        city: input.city,
        pin: input.pin,
        country: "India",
        return_address: input.returnAddress,
        return_city: input.returnCity ?? input.city,
        return_pin: input.returnPin,
        return_state: input.returnState ?? input.state,
        return_country: "India",
      },
    },
  );
  const r = (raw ?? {}) as Record<string, unknown>;
  const data = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
  const msg = (asString(data.message) ?? asString(r.message) ?? "").trim();
  const topErr =
    asString(r.error) ||
    (Array.isArray(r.error) ? (r.error as unknown[]).map(String).filter(Boolean).join("; ") : "") ||
    (typeof r.data === "string" ? (r.data as string) : "");
  // Idempotent no-op: Delhivery answers a re-registration of an existing
  // (deterministic K4U-<id>) name with "already exists" / "some error while
  // creating/updating warehouse" — sometimes 200, sometimes 4xx. Either way
  // the warehouse IS registered, which is all the caller needs. This branch
  // deliberately ignores httpOk so a dispatch that re-registers the pickup
  // point on the chosen account isn't blocked by that 4xx.
  if (/already\s*exist|exists?\b|some error while creating\/updating warehouse/i.test(msg)) {
    return { ok: true, data: { name: input.name }, raw };
  }
  if (httpOk && (r.success === true || /has been created/i.test(msg))) {
    return { ok: true, data: { name: input.name }, raw };
  }
  return {
    ok: false,
    // A bare 403 here is Delhivery's load balancer throttling this endpoint
    // (seen after a burst of registrations), not a rejected payload.
    error:
      topErr ||
      msg ||
      (status === 403
        ? "Delhivery temporarily refused warehouse registration (HTTP 403 — rate limited; retry later)."
        : `Delhivery rejected the warehouse registration (HTTP ${status}).`),
    raw,
  };
}

// --- Shipment creation (manifestation) ----------------------------------

export interface DelhiveryCreateShipmentInput {
  orderNumber: string;
  /** Registered Delhivery warehouse name for the seller's pickup point. */
  pickupWarehouseName: string;
  paymentMode: "COD" | "Prepaid";
  /**
   * Amount the courier collects on delivery — 0 for a prepaid order, and
   * for a partial-prepaid order the balance still owed (less than
   * totalAmount), not the full order value.
   */
  codAmount: number;
  /**
   * Declared invoice value of the goods — the full order value regardless
   * of how much was prepaid. Drives the invoice, the >50k e-waybill
   * threshold, and the loss/damage claim basis; may exceed codAmount.
   */
  totalAmount: number;
  consigneeName: string;
  consigneePhone: string;
  consigneeAddress: string;
  consigneePincode: string;
  consigneeCity?: string;
  consigneeState?: string;
  productsDesc: string;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  sellerName?: string;
}

export interface DelhiveryCreateShipmentResult {
  waybill: string;
  status: string;
  remarks?: string;
}

export async function delhiveryCreateShipment(
  account: DelhiveryAccountKey,
  input: DelhiveryCreateShipmentInput,
): Promise<DelhiveryResult<DelhiveryCreateShipmentResult>> {
  const data = {
    shipments: [
      {
        name: input.consigneeName,
        add: input.consigneeAddress,
        pin: input.consigneePincode,
        city: input.consigneeCity ?? "",
        state: input.consigneeState ?? "",
        country: "India",
        phone: normalizePhone(input.consigneePhone),
        order: input.orderNumber,
        payment_mode: input.paymentMode,
        cod_amount: input.paymentMode === "COD" ? String(input.codAmount) : "",
        total_amount: String(input.totalAmount),
        products_desc: input.productsDesc,
        quantity: "1",
        weight: String(input.weightGrams),
        shipment_length: String(input.lengthCm),
        shipment_width: String(input.breadthCm),
        shipment_height: String(input.heightCm),
        shipping_mode: "Surface",
        seller_name: input.sellerName ?? "",
        // Skipped -> Delhivery assigns a fresh waybill and returns it.
        waybill: "",
      },
    ],
    pickup_location: { name: input.pickupWarehouseName },
  };
  const { raw, httpOk } = await delhiveryRequest(account, "/api/cmu/create.json", "POST", {
    form: { format: "json", data: JSON.stringify(data) },
  });
  const r = (raw ?? {}) as Record<string, unknown>;
  const pkgs = Array.isArray(r.packages) ? (r.packages as Record<string, unknown>[]) : [];
  const pkg = pkgs[0];
  const waybill = asString(pkg?.waybill);
  const pkgStatus = asString(pkg?.status);
  const remarks = Array.isArray(pkg?.remarks)
    ? (pkg!.remarks as unknown[]).map(String).filter(Boolean).join("; ")
    : (asString(pkg?.remarks) ?? "");
  const failed =
    !httpOk ||
    r.success === false ||
    !waybill ||
    (pkgStatus != null && pkgStatus.toLowerCase() === "fail");
  if (failed) {
    const err =
      remarks ||
      asString(r.rmk) ||
      asString(r.error) ||
      asString(r.remarks) ||
      "Delhivery rejected the shipment.";
    return { ok: false, error: err, raw };
  }
  return { ok: true, data: { waybill: waybill!, status: pkgStatus ?? "Manifested", remarks }, raw };
}

// --- Reverse pickup (return to sender) --------------------------------

export interface DelhiveryReverseShipmentInput {
  /** `<orderNumber>-RETURN`, so it's distinct from the forward shipment's own order id. */
  orderNumber: string;
  /** Registered Delhivery warehouse name the parcel is delivered BACK to (the seller's pickup point). */
  returnWarehouseName: string;
  /** Where the courier PICKS UP FROM — the customer who has the parcel. */
  pickupName: string;
  pickupPhone: string;
  pickupAddress: string;
  pickupPincode: string;
  pickupCity?: string;
  pickupState?: string;
  productsDesc: string;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

/**
 * Books a reverse pickup with Delhivery — same `cmu/create.json` endpoint
 * as a forward shipment, with `shipment_type: "RVP"` and
 * `payment_mode: "Pickup"`. The consignee block is the CUSTOMER (courier
 * collects from them) and `pickup_location.name` is the seller's
 * registered warehouse the item goes back to — the mirror of
 * delhiveryCreateShipment's direction.
 */
export async function delhiveryCreateReverseShipment(
  account: DelhiveryAccountKey,
  input: DelhiveryReverseShipmentInput,
): Promise<DelhiveryResult<DelhiveryCreateShipmentResult>> {
  const data = {
    shipments: [
      {
        name: input.pickupName,
        add: input.pickupAddress,
        pin: input.pickupPincode,
        city: input.pickupCity ?? "",
        state: input.pickupState ?? "",
        country: "India",
        phone: normalizePhone(input.pickupPhone),
        order: input.orderNumber,
        payment_mode: "Pickup",
        shipment_type: "RVP",
        total_amount: "0",
        products_desc: input.productsDesc,
        quantity: "1",
        weight: String(input.weightGrams),
        shipment_length: String(input.lengthCm),
        shipment_width: String(input.breadthCm),
        shipment_height: String(input.heightCm),
        shipping_mode: "Surface",
        waybill: "",
      },
    ],
    pickup_location: { name: input.returnWarehouseName },
  };
  const { raw, httpOk } = await delhiveryRequest(account, "/api/cmu/create.json", "POST", {
    form: { format: "json", data: JSON.stringify(data) },
  });
  const r = (raw ?? {}) as Record<string, unknown>;
  const pkgs = Array.isArray(r.packages) ? (r.packages as Record<string, unknown>[]) : [];
  const pkg = pkgs[0];
  const waybill = asString(pkg?.waybill);
  const pkgStatus = asString(pkg?.status);
  const remarks = Array.isArray(pkg?.remarks)
    ? (pkg!.remarks as unknown[]).map(String).filter(Boolean).join("; ")
    : (asString(pkg?.remarks) ?? "");
  const failed =
    !httpOk ||
    r.success === false ||
    !waybill ||
    (pkgStatus != null && pkgStatus.toLowerCase() === "fail");
  if (failed) {
    const err =
      remarks ||
      asString(r.rmk) ||
      asString(r.error) ||
      asString(r.remarks) ||
      "Delhivery rejected the reverse pickup.";
    return { ok: false, error: err, raw };
  }
  return { ok: true, data: { waybill: waybill!, status: pkgStatus ?? "Manifested", remarks }, raw };
}

// --- Shipping label ----------------------------------------------------

export interface DelhiveryLabelResult {
  /** Delhivery-hosted S3 PDF link — presigned, ~24h TTL, so re-fetch per download. */
  labelUrl: string;
}

export async function delhiveryGenerateLabel(
  account: DelhiveryAccountKey,
  waybill: string,
): Promise<DelhiveryResult<DelhiveryLabelResult>> {
  const { raw, httpOk } = await delhiveryRequest(
    account,
    `/api/p/packing_slip?wbns=${encodeURIComponent(waybill)}&pdf=true&pdf_size=4R`,
    "GET",
  );
  const r = (raw ?? {}) as Record<string, unknown>;
  const pkgs = Array.isArray(r.packages) ? (r.packages as Record<string, unknown>[]) : [];
  const link =
    asString(pkgs[0]?.pdf_download_link) ??
    asString(pkgs[0]?.pdf_url) ??
    asString(r.pdf_download_link);
  if (!httpOk || !link || !/^https?:\/\//i.test(link)) {
    return {
      ok: false,
      error: asString(r.error) ?? asString(r.rmk) ?? "Delhivery did not return a label URL.",
      raw,
    };
  }
  return { ok: true, data: { labelUrl: link }, raw };
}

// --- Tracking --------------------------------------------------------

export interface DelhiveryTrackResult {
  status?: string;
  statusType?: string;
  statusDesc?: string;
  awb?: string;
}

export async function delhiveryTrackShipment(
  account: DelhiveryAccountKey,
  waybill: string,
): Promise<DelhiveryResult<DelhiveryTrackResult>> {
  const { raw, httpOk } = await delhiveryRequest(
    account,
    `/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`,
    "GET",
  );
  if (!httpOk) return { ok: false, error: "Delhivery tracking request failed.", raw };
  const r = (raw ?? {}) as Record<string, unknown>;
  const shipments = Array.isArray(r.ShipmentData)
    ? (r.ShipmentData as Record<string, unknown>[])
    : [];
  const shipment = shipments[0]?.Shipment as Record<string, unknown> | undefined;
  if (!shipment) return { ok: false, error: "Tracking data not found for your request.", raw };
  const st = shipment.Status as Record<string, unknown> | undefined;
  return {
    ok: true,
    data: {
      status: asString(st?.Status),
      statusType: asString(st?.StatusType),
      statusDesc: asString(st?.Instructions) ?? asString(st?.StatusLocation),
      awb: asString(shipment.AWB),
    },
    raw,
  };
}

// --- Cancellation ---------------------------------------------------

export async function delhiveryCancelShipment(
  account: DelhiveryAccountKey,
  waybill: string,
): Promise<DelhiveryResult<null>> {
  const { raw, httpOk } = await delhiveryRequest(account, "/api/p/edit", "POST", {
    json: { waybill, cancellation: "true" },
  });
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!httpOk || r.status === false || r.success === false) {
    return {
      ok: false,
      error: asString(r.remarks) ?? asString(r.error) ?? "Delhivery rejected the cancellation.",
      raw,
    };
  }
  return { ok: true, data: null, raw };
}

// --- Status mapping -------------------------------------------------

export type DelhiveryMappedStatus =
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "RTO_INITIATED"
  | "RTO_DELIVERED_TO_SELLER";

/**
 * Forward-leg mapping (StatusType "UD" / "DL") from Delhivery's status
 * string to this app's ShipmentStatus, mirroring
 * RAPIDSHYP_FORWARD_STATUS_MAP's conservative approach. Delhivery has no
 * explicit "picked up" forward status (it goes Manifested -> In Transit),
 * so "In Transit" maps to IN_TRANSIT and the caller's forward-sequence
 * auto-advance walks through PICKED_UP.
 *
 * The return leg is NOT in this map — it is keyed on StatusType as well
 * as the status string, see resolveDelhiveryShipmentStatus below.
 */
export const DELHIVERY_FORWARD_STATUS_MAP: Record<string, DelhiveryMappedStatus> = {
  "In Transit": "IN_TRANSIT",
  Pending: "IN_TRANSIT",
  Dispatched: "IN_TRANSIT",
  Delivered: "DELIVERED",
};

/**
 * The single place a Delhivery (Status, StatusType) pair becomes this
 * app's ShipmentStatus. Confirmed against a full real return journey,
 * K4U-20260907-8134-S1:
 *
 *  - Forward leg (StatusType "UD"): Manifested -> In Transit -> Pending ->
 *    Dispatched (out for delivery).
 *  - Return leg (StatusType "RT"): starts at "RT-108 No client
 *    instructions to Reattempt"; every scan after it — "In Transit",
 *    "Pending", "Dispatched for RTO" — carries StatusType "RT" while the
 *    parcel travels back. => RTO_INITIATED ("RTO in transit").
 *  - Final scan: Status "RTO", StatusType "DL", code RD-AC, "RETURN
 *    Accepted" at the return centre. Nothing follows it (the same status
 *    sat unchanged for days) — the parcel is back with the origin. =>
 *    RTO_DELIVERED_TO_SELLER ("Return to origin").
 *
 * StatusType "PP", "PU" and "CN" (pickup pending / pickup / cancelled)
 * stay unmapped: the tracking fields on Shipment still update, but no
 * transition is attempted.
 */
export function resolveDelhiveryShipmentStatus(
  status: string | undefined,
  statusType: string | undefined,
): DelhiveryMappedStatus | undefined {
  if (!status) return undefined;
  if (status === "RTO") return statusType === "DL" ? "RTO_DELIVERED_TO_SELLER" : "RTO_INITIATED";
  if (statusType === "RT") return "RTO_INITIATED";
  if (statusType === "UD" || statusType === "DL" || !statusType) {
    return DELHIVERY_FORWARD_STATUS_MAP[status];
  }
  return undefined;
}
