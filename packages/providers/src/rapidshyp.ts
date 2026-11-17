/**
 * RapidShyp (delivery aggregator) integration — unlike every other
 * provider in this package, this one calls a REAL production API with a
 * real credential (`RAPIDSHYP_API_KEY`). It is the first live third-party
 * integration in this codebase; every other provider here (sms.ts,
 * payment.ts, logistics.ts) stays a local mock per the original MVP
 * architecture decision (NEXTJS_ARCHITECTURE_PLAN.md §10 — "no real
 * payment/SMS/email/WhatsApp/Firebase/notification services"). That
 * constraint was about keeping local dev simple during the initial build,
 * not a permanent restriction — RapidShyp is a deliberate, later decision
 * to bring in a real courier for real dispatch.
 *
 * Docs: https://api.rapidshyp.com/rapidshyp/apis/v1/ — auth via the
 * `rapidshyp-token` header on every request.
 *
 * RapidShyp's own "did this succeed" shape is inconsistent per endpoint
 * (`status:"SUCCESS"`, `status:true`, or `success:true`) —
 * normalizeRapidShypResponse below is the one place that absorbs that, so
 * every call site here just checks `.ok`.
 */

const RAPIDSHYP_BASE_URL = "https://api.rapidshyp.com/rapidshyp/apis/v1/";

export interface RapidShypAddress {
  firstName: string;
  lastName?: string;
  addressLine1: string;
  addressLine2?: string;
  pinCode: string;
  email?: string;
  phone: string;
}

export interface RapidShypOrderItem {
  itemName: string;
  sku?: string;
  description?: string;
  units: number;
  unitPrice: number;
  tax: number;
  hsn?: string;
  productLength?: number;
  productBreadth?: number;
  productHeight?: number;
  productWeight?: number;
  brand?: string;
  imageURL?: string;
  isFragile?: boolean;
  isPersonalisable?: boolean;
}

export interface RapidShypPackageDetails {
  packageLength: number;
  packageBreadth: number;
  packageHeight: number;
  packageWeight: number;
}

export interface RapidShypPickupLocationInput {
  contactName: string;
  pickupName: string;
  pickupEmail?: string;
  pickupPhone: string;
  pickupAddress1: string;
  pickupAddress2?: string;
  pinCode: string;
}

export interface CreateRapidShypOrderRequest {
  orderId: string;
  orderDate: string;
  storeName: string;
  billingIsShipping: boolean;
  shippingAddress: RapidShypAddress;
  billingAddress?: RapidShypAddress;
  orderItems: RapidShypOrderItem[];
  paymentMethod: "COD" | "PREPAID";
  packageDetails: RapidShypPackageDetails;
  // Exactly one of these two must be set — enforced by the caller, not
  // this type, since the two are mutually exclusive per RapidShyp's docs.
  pickupAddressName?: string;
  pickupLocation?: RapidShypPickupLocationInput;
  shippingCharges?: number;
  giftWrapCharges?: number;
  transactionCharges?: number;
  totalDiscount?: number;
  codCharges?: number;
  prepaidAmount?: number;
}

export type RapidShypResult<T> =
  | { ok: true; data: T; raw: unknown }
  | { ok: false; error: string; raw: unknown };

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

async function rapidshypRequest(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ raw: unknown; httpOk: boolean }> {
  const apiKey = process.env.RAPIDSHYP_API_KEY;
  if (!apiKey) throw new Error("RAPIDSHYP_API_KEY is not configured.");
  let res: Response;
  try {
    res = await fetch(`${RAPIDSHYP_BASE_URL}${path}`, {
      method,
      headers: { "rapidshyp-token": apiKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { raw: null, httpOk: false };
  }
  // Some endpoints (create/pickup_location) answer a rejected body with a
  // plain-text error instead of JSON — surface that text as the message.
  const text = await res.text().catch(() => "");
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = { status: false, message: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  }
  return { raw, httpOk: res.ok };
}

function normalizeRapidShypResponse(raw: unknown): { ok: boolean; message: string } {
  if (!raw || typeof raw !== "object")
    return { ok: false, message: "Empty or invalid response from RapidShyp." };
  const r = raw as Record<string, unknown>;
  // approve_orders reports success as the lowercase string "success" —
  // every other endpoint here uses "SUCCESS" — so this compares
  // case-insensitively rather than adding a third status shape to check.
  const ok =
    (typeof r.status === "string" && r.status.toUpperCase() === "SUCCESS") ||
    r.status === true ||
    r.success === true;
  const message =
    asString(r.remarks) || asString(r.remark) || asString(r.msg) || asString(r.message) ||
    (ok ? "OK" : "RapidShyp reported an error.");
  return { ok, message };
}

export interface CreateRapidShypOrderResult {
  rapidshypOrderId: string;
  shipment: unknown;
}

export async function rapidshypCreateOrder(
  payload: CreateRapidShypOrderRequest,
): Promise<RapidShypResult<CreateRapidShypOrderResult>> {
  const { raw, httpOk } = await rapidshypRequest("create_order", "POST", payload);
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const orderId = asString(r.order_id);
  if (!orderId) return { ok: false, error: "RapidShyp did not return an order_id.", raw };
  return { ok: true, data: { rapidshypOrderId: orderId, shipment: r.shipment ?? null }, raw };
}

// --- Wrapper API (EXPERIMENTAL — not yet used by any live dispatch path) --

export interface RapidShypWrapperShipment {
  shipmentId?: string;
  awb?: string;
  awbGenerated?: boolean;
  labelGenerated?: boolean;
  pickupScheduled?: boolean;
  courierCode?: string;
  courierName?: string;
  parentCourierName?: string;
  labelUrl?: string;
  manifestUrl?: string;
  collectableAmount?: number;
  totalOrderValue?: number;
  prepaidAmount?: number;
}

export interface RapidShypWrapperResult {
  rapidshypOrderId: string;
  orderCreated: boolean;
  shipments: RapidShypWrapperShipment[];
}

/**
 * The B2C Wrapper API (`POST /wrapper`) — bundles create_order,
 * serviceability check, courier selection, AWB assignment, and label
 * generation into ONE call, versus the four separate calls
 * (rapidshypCreateOrder -> rapidshypApproveOrder -> rapidshypAssignAwb ->
 * rapidshypGenerateLabel) the live dispatch path uses today. Takes the
 * same CreateRapidShypOrderRequest shape as create_order (confirmed
 * against https://docs.rapidshyp.com/docs/documentationsidebar/wrapper/b2c%20wrapper%20api
 * — same camelCase field names).
 *
 * NOT wired into sendSellerOrderToRapidShyp yet — this exists for the
 * live test-order comparison (one COD order, one ONLINE_PARTIAL-style
 * order with prepaidAmount set) to confirm the response shape and
 * courier-autopick behavior before cutting the real dispatch flow over.
 * Response field casing is unverified against a real call (the docs page
 * gives camelCase, but create_order's own response is snake_case despite
 * a camelCase request — RapidShyp is inconsistent per-endpoint, see this
 * file's top comment), so every field here defensively checks both.
 */
export async function rapidshypCreateWrapperOrder(
  payload: CreateRapidShypOrderRequest,
): Promise<RapidShypResult<RapidShypWrapperResult>> {
  const { raw, httpOk } = await rapidshypRequest("wrapper", "POST", payload);
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const orderId = asString(r.orderId) ?? asString(r.order_id);
  if (!orderId) return { ok: false, error: "RapidShyp did not return an orderId.", raw };
  const orderCreated =
    r.orderCreated === true || r.order_created === true || (r.orderCreated ?? r.order_created) == null;
  const shipmentsRaw = Array.isArray(r.shipment)
    ? (r.shipment as Record<string, unknown>[])
    : Array.isArray(r.shipments)
      ? (r.shipments as Record<string, unknown>[])
      : [];
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  const shipments = shipmentsRaw.map((s) => ({
    shipmentId: asString(s.shipmentId) ?? asString(s.shipment_id),
    awb: asString(s.awb),
    awbGenerated: bool(s.awbGenerated) ?? bool(s.awb_generated),
    labelGenerated: bool(s.labelGenerated) ?? bool(s.label_generated),
    pickupScheduled: bool(s.pickupScheduled) ?? bool(s.pickup_scheduled),
    courierCode: asString(s.courierCode) ?? asString(s.courier_code),
    courierName: asString(s.courierName) ?? asString(s.courier_name),
    parentCourierName: asString(s.parentCourierName) ?? asString(s.parent_courier_name),
    labelUrl: asString(s.labelURL) ?? asString(s.label_url) ?? asString(s.labelUrl),
    manifestUrl: asString(s.manifestURL) ?? asString(s.manifest_url) ?? asString(s.manifestUrl),
    collectableAmount: num(s.collectableAmount) ?? num(s.collectable_amount),
    totalOrderValue: num(s.totalOrderValue) ?? num(s.total_order_value),
    prepaidAmount: num(s.prepaidAmount) ?? num(s.prepaid_amount),
  }));
  return { ok: true, data: { rapidshypOrderId: orderId, orderCreated, shipments }, raw };
}

export interface RapidShypReturnPickupAddress {
  pickupCustomerName: string;
  pickupCustomerLastName?: string;
  pickupEmail?: string;
  pickupPhone: string;
  pickupAddress: string;
  pickupAddress2?: string;
  pickupPincode: string;
}

export interface RapidShypReturnOrderItem {
  itemName: string;
  sku?: string;
  units: number;
  unitPrice: number;
  tax?: number;
  hsn?: string;
  productLength?: number;
  productBreadth?: number;
  productHeight?: number;
  productWeight?: number;
  brand?: string;
}

export interface CreateRapidShypReturnOrderRequest {
  orderId: string;
  orderDate: string;
  /** Reverse direction from a forward shipment — this is where the courier PICKS UP FROM (the customer), not where it delivers to. */
  pickupLocation: RapidShypReturnPickupAddress;
  storeName: string;
  returnReasonCode?: string;
  /**
   * Where the item is delivered BACK to — RapidShyp's docs mark the full
   * deliveryAddress object as conditional/unneeded when this name matches
   * an already-registered RapidShyp pickup location (the same
   * pickupAddressName a seller's forward shipments already use as their
   * origin — reused here as the return's destination). This app only ever
   * sends a seller's already-registered name, never a fresh inline address.
   */
  deliveryAddressName: string;
  orderItems: RapidShypReturnOrderItem[];
  packageDetails: {
    packageLength: number;
    packageBreadth: number;
    packageHeight: number;
    packageWeight: number;
  };
  comment?: string;
}

export interface CreateRapidShypReturnOrderResult {
  rapidshypOrderId: string;
  shipmentId?: string;
}

/**
 * The reverse-pickup counterpart to rapidshypCreateOrder — a single call,
 * no separate approve_orders step (confirmed against
 * https://docs.rapidshyp.com/docs/documentationsidebar/return%20api/post%20create%20return%20order/:
 * the response's own shipment[].shipment_id comes back populated
 * immediately, unlike create_order's always-empty shipment array). Used
 * only for a post-delivery return whose original shipment actually went
 * via RapidShyp — a mock/manual-logistics return has no equivalent call
 * (see packages/orders/src/rapidshyp-return.ts).
 */
export async function rapidshypCreateReturnOrder(
  input: CreateRapidShypReturnOrderRequest,
): Promise<RapidShypResult<CreateRapidShypReturnOrderResult>> {
  const { raw, httpOk } = await rapidshypRequest("create_return", "POST", {
    orderId: input.orderId,
    orderDate: input.orderDate,
    pickupLocation: {
      pickup_customer_name: input.pickupLocation.pickupCustomerName,
      pickup_customer_last_name: input.pickupLocation.pickupCustomerLastName,
      pickup_email: input.pickupLocation.pickupEmail,
      pickup_phone: input.pickupLocation.pickupPhone,
      pickup_address: input.pickupLocation.pickupAddress,
      pickup_address_2: input.pickupLocation.pickupAddress2,
      pickup_pincode: input.pickupLocation.pickupPincode,
    },
    storeName: input.storeName,
    return_reason_code: input.returnReasonCode,
    deliveryAddress_name: input.deliveryAddressName,
    orderItems: input.orderItems.map((item) => ({
      itemName: item.itemName,
      sku: item.sku,
      units: item.units,
      unitPrice: item.unitPrice,
      tax: item.tax,
      hsn: item.hsn,
      productLength: item.productLength,
      productBreadth: item.productBreadth,
      productHeight: item.productHeight,
      productWeight: item.productWeight,
      brand: item.brand,
    })),
    packageDetails: input.packageDetails,
    comment: input.comment,
  });
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const orderId = asString(r.order_id);
  if (!orderId) return { ok: false, error: "RapidShyp did not return an order_id.", raw };
  const shipments = Array.isArray(r.shipment) ? (r.shipment as Record<string, unknown>[]) : [];
  const shipmentId = asString(shipments[0]?.shipment_id);
  return { ok: true, data: { rapidshypOrderId: orderId, shipmentId }, raw };
}

export interface ApproveRapidShypOrderResult {
  shipmentId?: string;
}

/**
 * create_order alone leaves an order sitting unapproved — its response
 * always comes back `"shipment": []` (confirmed live) — which never
 * surfaces as a real shipment anywhere in RapidShyp's dashboard and can
 * never be tracked. approve_orders is the separate, mandatory call
 * (confirmed against https://docs.rapidshyp.com and live testing) that
 * turns it into an actual shipment with a shipment_id. Without this
 * call, "sending to RapidShyp" silently did nothing beyond registering
 * an order nobody could ever see or ship — the root cause of orders not
 * appearing on RapidShyp's side after a push that reported success here.
 */
export async function rapidshypApproveOrder(input: {
  orderId: string;
  storeName: string;
}): Promise<RapidShypResult<ApproveRapidShypOrderResult>> {
  const { raw, httpOk } = await rapidshypRequest("approve_orders", "POST", {
    order_id: [input.orderId],
    store_name: input.storeName,
  });
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const orderList = Array.isArray(r.order_list) ? (r.order_list as Record<string, unknown>[]) : [];
  const shipments = Array.isArray(orderList[0]?.shipment)
    ? (orderList[0]!.shipment as Record<string, unknown>[])
    : [];
  const shipmentId = asString(shipments[0]?.shipment_id);
  if (Number(r.failure_count) > 0 && !shipmentId)
    return { ok: false, error: "RapidShyp rejected the order approval.", raw };
  return { ok: true, data: { shipmentId }, raw };
}

export interface RapidShypServiceableCourier {
  courierCode: string;
  courierName?: string;
  parentCourierName?: string;
  freightMode?: string;
  totalFreight?: number;
  edd?: string;
}

/**
 * Which couriers can carry this pickup->delivery route for the given
 * weight/value. The live endpoint is the MISSPELLED "serviceabilty_check"
 * — the docs "URL" field says "serviceability_check" but only the
 * misspelled path (as in RapidShyp's own curl example) responds.
 */
export async function rapidshypCheckServiceability(input: {
  pickupPincode: string;
  deliveryPincode: string;
  cod: boolean;
  totalOrderValue: number;
  /** kilograms */
  weight: number;
}): Promise<RapidShypResult<RapidShypServiceableCourier[]>> {
  const { raw, httpOk } = await rapidshypRequest("serviceabilty_check", "POST", {
    Pickup_pincode: input.pickupPincode,
    Delivery_pincode: input.deliveryPincode,
    cod: input.cod,
    total_order_value: input.totalOrderValue,
    weight: input.weight,
  });
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.serviceable_courier_list)
    ? (r.serviceable_courier_list as Record<string, unknown>[])
    : [];
  const couriers = list
    .map((c) => ({
      courierCode: asString(c.courier_code) ?? "",
      courierName: asString(c.courier_name),
      parentCourierName: asString(c.parent_courier_name),
      freightMode: asString(c.freight_mode),
      totalFreight: typeof c.total_freight === "number" ? c.total_freight : undefined,
      edd: asString(c.edd),
    }))
    .filter((c) => c.courierCode.length > 0);
  return { ok: true, data: couriers, raw };
}

export interface RapidShypShipmentDetails {
  warehousePincode?: string;
  deadWeightGrams?: number;
  appliedWeightGrams?: number;
  shipmentStatus?: string;
  awb?: string;
  courierName?: string;
}

/** GET /shipment_details — carries the pickup (warehouse) pincode + weight that assign_awb's serviceability fallback needs. */
export async function rapidshypGetShipmentDetails(
  shipmentId: string,
): Promise<RapidShypResult<RapidShypShipmentDetails>> {
  const { raw, httpOk } = await rapidshypRequest(
    `shipment_details?shipment_id=${encodeURIComponent(shipmentId)}`,
    "GET",
  );
  if (!httpOk) return { ok: false, error: "RapidShyp shipment_details request failed.", raw };
  const r = raw as Record<string, unknown>;
  const d = (r.shipment_details ?? {}) as Record<string, unknown>;
  if (r.success !== true && !d.shipment_id)
    return { ok: false, error: asString(r.msg) ?? "RapidShyp returned no shipment details.", raw };
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    ok: true,
    data: {
      warehousePincode: asString(d.warehouse_pin_code),
      deadWeightGrams: num(d.dead_weight),
      appliedWeightGrams: num(d.applied_weight),
      shipmentStatus: asString(d.shipment_status),
      awb: asString(d.awb),
      courierName: asString(d.courier_name),
    },
    raw,
  };
}

export interface RapidShypAssignAwbResult {
  awb: string;
  courierName?: string;
  courierCode?: string;
  parentCourierName?: string;
}

/**
 * approve_orders creates a shipment but never assigns an AWB (confirmed
 * live: it leaves `awb` ""), and a courier label cannot exist until one
 * is — generate_label returns "AWB not assigned yet on shipment."
 * otherwise. This is the separate B2C step that picks a courier and
 * returns the AWB synchronously.
 *
 * With an empty courier_code RapidShyp is meant to auto-pick per the
 * account's courier rule/priority — but an account with no rule
 * configured just answers "Failed to assign courier". So when the
 * auto-pick attempt fails and `fallbackRoute` is given, this looks up a
 * serviceable courier for that exact route and retries with an explicit
 * courier_code (cheapest freight first). A hard account-level block (no
 * wallet balance, no courier partners activated) still fails, now with
 * RapidShyp's own message ("AWB allocation failed for all shipments").
 *
 * Booking real courier capacity is a real side effect — only call this at
 * genuine dispatch time or an explicit admin retry.
 */
export async function rapidshypAssignAwb(input: {
  shipmentId: string;
  courierCode?: string;
  fallbackRoute?: {
    pickupPincode: string;
    deliveryPincode: string;
    cod: boolean;
    totalOrderValue: number;
    weight: number;
  };
}): Promise<RapidShypResult<RapidShypAssignAwbResult>> {
  const attempt = (courierCode: string) =>
    rapidshypRequest("assign_awb", "POST", {
      shipment_id: input.shipmentId,
      courier_code: courierCode,
    });

  let { raw, httpOk } = await attempt(input.courierCode ?? "");
  let normalized = normalizeRapidShypResponse(raw);

  if ((!httpOk || !normalized.ok) && !input.courierCode && input.fallbackRoute) {
    const svc = await rapidshypCheckServiceability({
      pickupPincode: input.fallbackRoute.pickupPincode,
      deliveryPincode: input.fallbackRoute.deliveryPincode,
      cod: input.fallbackRoute.cod,
      totalOrderValue: input.fallbackRoute.totalOrderValue,
      weight: input.fallbackRoute.weight,
    });
    if (svc.ok && svc.data.length > 0) {
      const pick = [...svc.data].sort(
        (a, b) =>
          (a.totalFreight ?? Number.MAX_SAFE_INTEGER) - (b.totalFreight ?? Number.MAX_SAFE_INTEGER),
      )[0]!;
      ({ raw, httpOk } = await attempt(pick.courierCode));
      normalized = normalizeRapidShypResponse(raw);
    }
  }

  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const awb = asString(r.awb);
  if (!awb) return { ok: false, error: "RapidShyp did not return an AWB.", raw };
  return {
    ok: true,
    data: {
      awb,
      courierName: asString(r.courier_name),
      courierCode: asString(r.courier_code),
      parentCourierName: asString(r.parent_courier_name),
    },
    raw,
  };
}

export interface RapidShypLabelResult {
  /** RapidShyp-hosted PDF on their public S3 bucket — no auth needed to fetch it. */
  labelUrl: string;
}

/**
 * Generates (and returns the hosted URL of) the shipping-label PDF for a
 * shipment that already has an AWB. Documented as GET but is actually
 * POST (live GET -> HTTP 405); the body takes an ARRAY of shipment ids.
 * Two response shapes have been seen live: the documented
 * `{ status: true, labelData: [{ labelURL }] }` and an error body
 * `{ label_created: 0, failure_count: 1, label_url: "", response: "..." }`
 * — both are handled here.
 */
export async function rapidshypGenerateLabel(input: {
  shipmentId: string;
}): Promise<RapidShypResult<RapidShypLabelResult>> {
  const { raw, httpOk } = await rapidshypRequest("generate_label", "POST", {
    shipmentId: [input.shipmentId],
  });
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const labelData = Array.isArray(r.labelData) ? (r.labelData as Record<string, unknown>[]) : [];
  const candidate =
    asString(labelData[0]?.labelURL) ??
    asString(labelData[0]?.label_url) ??
    asString(r.label_url);
  const labelUrl = candidate && candidate.length > 0 ? candidate : undefined;
  if (!httpOk || !labelUrl) {
    const message =
      asString(r.response) ??
      asString(labelData[0]?.labelRemarks) ??
      normalizeRapidShypResponse(raw).message;
    return { ok: false, error: message, raw };
  }
  return { ok: true, data: { labelUrl }, raw };
}

export interface RapidShypTrackShipmentDetail {
  awb?: string;
  courierName?: string;
  statusCode?: string;
  statusDesc?: string;
}

export interface RapidShypTrackResult {
  orderStatus?: string;
  shipment?: RapidShypTrackShipmentDetail;
}

export async function rapidshypTrackOrder(input: {
  orderId?: string;
  awb?: string;
}): Promise<RapidShypResult<RapidShypTrackResult>> {
  if (!input.orderId && !input.awb) throw new Error("rapidshypTrackOrder requires orderId or awb.");
  const { raw, httpOk } = await rapidshypRequest("track_order", "POST", input);
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const records = Array.isArray(r.records) ? (r.records as Record<string, unknown>[]) : [];
  const record = records[0];
  if (!record) return { ok: true, data: {}, raw };
  const shipments = Array.isArray(record.shipment_details)
    ? (record.shipment_details as Record<string, unknown>[])
    : [];
  const shipment = shipments[0];
  return {
    ok: true,
    data: {
      orderStatus: asString(record.order_status),
      shipment: shipment
        ? {
            awb: asString(shipment.awb),
            courierName: asString(shipment.courier_name),
            statusCode: asString(shipment.current_tracking_status_code),
            statusDesc: asString(shipment.current_tracking_status_desc),
          }
        : undefined,
    },
    raw,
  };
}

export async function rapidshypCancelOrder(input: {
  orderId: string;
  storeName: string;
}): Promise<RapidShypResult<null>> {
  const { raw, httpOk } = await rapidshypRequest("cancel_order", "POST", input);
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  return { ok: true, data: null, raw };
}

export interface RapidShypPickupLocationListItem {
  pickupName: string;
  contactName: string;
  contactNumber: string;
  contactEmail?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  pinCode: string;
  status: string;
}

export async function rapidshypFetchPickupLocations(): Promise<
  RapidShypResult<RapidShypPickupLocationListItem[]>
> {
  const { raw, httpOk } = await rapidshypRequest("fetch_pickup_location", "GET");
  const normalized = normalizeRapidShypResponse(raw);
  if (!httpOk || !normalized.ok) return { ok: false, error: normalized.message, raw };
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.pickup_location_list)
    ? (r.pickup_location_list as Record<string, unknown>[])
    : [];
  const data = list.map((p) => ({
    pickupName: asString(p.pickup_name) ?? "",
    contactName: asString(p.contact_name) ?? "",
    contactNumber: asString(p.contact_number) ?? "",
    contactEmail: asString(p.contact_email),
    address1: asString(p.pickup_address_1) ?? "",
    address2: asString(p.pickup_address_2),
    city: asString(p.city) ?? "",
    state: asString(p.state) ?? "",
    pinCode: asString(p.pin_code) ?? "",
    status: asString(p.status) ?? "",
  }));
  return { ok: true, data, raw };
}

export interface RapidShypCreatePickupLocationInput {
  /** RapidShyp's `address_name` — what create_order/wrapper later pass as pickupAddressName. */
  name: string;
  /** Alphabets only per RapidShyp's validation — the caller sanitizes. */
  contactName: string;
  /** 10 digits. */
  contactNumber: string;
  email?: string;
  /** 3-100 chars each. */
  addressLine: string;
  addressLine2?: string;
  pincode: string;
}

/**
 * POST /create/pickup_location — registers a pickup location on the
 * account, with RTO (returns) going back to the same address. RapidShyp has
 * no documented edit endpoint ("Update Pickup Location" is "Coming Soon" in
 * their docs), so an address change is registered as a new location under a
 * new name by the caller (see courier-pickup-sync.ts).
 *
 * Re-registering a name that already exists is treated as success, so a
 * retry after a lost response (or a second approval) is harmless.
 */
export async function rapidshypCreatePickupLocation(
  input: RapidShypCreatePickupLocationInput,
): Promise<RapidShypResult<{ name: string }>> {
  const { raw, httpOk } = await rapidshypRequest("create/pickup_location", "POST", {
    address_name: input.name,
    contact_name: input.contactName,
    contact_number: input.contactNumber,
    ...(input.email ? { email: input.email } : {}),
    address_line: input.addressLine,
    ...(input.addressLine2 ? { address_line2: input.addressLine2 } : {}),
    pincode: input.pincode,
    // Documented as optional, but the live API rejects a body without it
    // ("missing field `dropship_location`").
    dropship_location: false,
    use_alt_rto_address: false,
  });
  const normalized = normalizeRapidShypResponse(raw);
  if (httpOk && normalized.ok) {
    const r = raw as Record<string, unknown>;
    return { ok: true, data: { name: asString(r.pickup_location_name) ?? input.name }, raw };
  }
  if (/already\s*exist|duplicate/i.test(normalized.message)) {
    return { ok: true, data: { name: input.name }, raw };
  }
  return { ok: false, error: normalized.message, raw };
}

/**
 * Forward-progress-only mapping from RapidShyp's tracking status code to
 * this app's ShipmentStatus. Deliberately conservative: only OrderStatus's
 * wired subset (PICKED_UP/IN_TRANSIT/DELIVERED/DELIVERY_FAILED/
 * RTO_INITIATED) has real business logic behind it (settlement, payout,
 * notifications) — every OTHER return/damage/hold code (DMG, LST, ONH,
 * MSR, DPO, CAN, and anything unrecognized) intentionally maps to null:
 * the tracking fields on Shipment still get updated, but no OrderStatus
 * transition is attempted, because those target states have no business
 * logic wired up yet (see OrderStatus's own doc comment in
 * schema.prisma). CAN is included in that "no auto-transition" set on
 * purpose — order cancellation has its own dedicated flow
 * (packages/orders/src/cancellation.ts) with refund side effects that
 * must never fire from an unattended tracking poll.
 *
 * RTO_* is a whole family of codes, not one fixed string (no live
 * RapidShyp RTO example was available to confirm the exact set at the
 * time this was wired — unlike Delhivery's "RTO", confirmed against a
 * real shipment) — see resolveRapidShypForwardStatus below, which checks
 * this map first and falls back to a prefix match for any code starting
 * "RTO".
 */
export const RAPIDSHYP_FORWARD_STATUS_MAP: Record<
  string,
  "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "DELIVERY_FAILED" | "RTO_INITIATED"
> = {
  PUC: "PICKED_UP",
  INT: "IN_TRANSIT",
  SPD: "IN_TRANSIT",
  RAD: "IN_TRANSIT",
  OFD: "IN_TRANSIT",
  DEL: "DELIVERED",
  UND: "DELIVERY_FAILED",
};

/**
 * Resolves a RapidShyp status code to a forward ShipmentStatus, same
 * conservative rules as the map above, plus the RTO_* prefix family
 * (RTO_INT, RTO_DEL, RTO_ND, ... — RapidShyp's own doc calls this out as
 * a prefixed family rather than a fixed code list). Any code starting
 * "RTO" that isn't a more specific mapped value is treated as
 * RTO_INITIATED — the courier has started sending the shipment back.
 * RTO_DEL ("RTO Delivered", seen live on K4U-20260907-4608-S1 and others)
 * is the one final code: the parcel is back with the seller.
 */
export function resolveRapidShypForwardStatus(
  code: string,
):
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "RTO_INITIATED"
  | "RTO_DELIVERED_TO_SELLER"
  | undefined {
  const mapped = RAPIDSHYP_FORWARD_STATUS_MAP[code];
  if (mapped) return mapped;
  if (code === "RTO_DEL") return "RTO_DELIVERED_TO_SELLER";
  return code.startsWith("RTO") ? "RTO_INITIATED" : undefined;
}
