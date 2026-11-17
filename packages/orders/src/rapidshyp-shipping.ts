import { prisma, Prisma, type UserRole } from "@kisan4u/db";
import {
  rapidshypCreateWrapperOrder,
  rapidshypAssignAwb,
  rapidshypCheckServiceability,
  rapidshypGenerateLabel,
  rapidshypGetShipmentDetails,
  rapidshypTrackOrder,
  resolveRapidShypForwardStatus,
  type CreateRapidShypOrderRequest,
  type RapidShypWrapperShipment,
} from "@kisan4u/providers";
import type { DispatchViaWizardInput, SendToRapidShypInput } from "@kisan4u/validators";
import { recordStatusChange } from "./status-transitions";
import { writeAuditLog } from "./audit";
import { notifyBuyer } from "./notifications";
import { round2 } from "./money";
import {
  acceptOrder,
  acceptOrderAsAdmin,
  advanceShipmentToStatus,
  isRepeatOfCurrentShipmentStatus,
  markPacked,
  markPackedAsAdmin,
  packAndScheduleMockPickup,
  type SellerOrderWithShipment,
  type WorkflowResult,
} from "./order-workflow";
import { packAndSendToDelhivery } from "./delhivery-shipping";
import { ensureRapidShypPickupLocation } from "./courier-pickup-sync";

// A variant with no dims on file (see the compatibility check that
// preceded this integration — order-level/item-level package dimensions
// are a genuine schema gap, ~5% of variants) falls back to this rather
// than sending RapidShyp a 0, which their API would likely reject.
// Exported for rapidshyp-return.ts, which needs the exact same fallback
// for the returned item's own dims.
export const DEFAULT_ITEM_DIM_CM = 10;

export function metresToCm(value: unknown): number {
  return value != null ? Number(value) * 100 : DEFAULT_ITEM_DIM_CM;
}

// RapidShyp's own convention for a single-channel account (confirmed
// against their API docs) — not a placeholder. Exported for
// rapidshyp-return.ts, which sends to the same account.
export const RAPIDSHYP_STORE_NAME = "DEFAULT";

/**
 * True when an existing Shipment row represents a RapidShyp order that was
 * created on their side (create_order succeeded, so it's already visible
 * on RapidShyp's own dashboard) but never finished dispatching — a later
 * step (approve_orders, our own DB write, a transient network error) threw
 * before this order reached PICKUP_SCHEDULED. Safe to resume from rather
 * than the genuine "already shipped" state a second attempt must still be
 * blocked from touching. See sendSellerOrderToRapidShyp's doc comment for
 * why this distinction exists at all.
 */
function isResumableRapidShypShipment(
  shipment: { provider: string; status: string; awbNumber: string | null } | null | undefined,
): boolean {
  return (
    !!shipment &&
    shipment.provider === "RAPIDSHYP" &&
    shipment.status === "CREATED" &&
    !shipment.awbNumber
  );
}

/** The shipment id from a failed /wrapper response, if RapidShyp created the order before failing. */
function shipmentIdFromWrapperRaw(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.shipment) ? r.shipment : Array.isArray(r.shipments) ? r.shipments : [];
  const first = (list[0] ?? {}) as Record<string, unknown>;
  const id = first.shipmentId ?? first.shipment_id;
  return typeof id === "string" && id ? id : undefined;
}

/** Appends which couriers RapidShyp says serve this route, so a courier-rule gap is obvious from the error. */
async function serviceableCourierHint(route: {
  pickupPincode: string;
  deliveryPincode: string;
  cod: boolean;
  totalOrderValue: number;
  weight: number;
}): Promise<string> {
  const svc = await rapidshypCheckServiceability(route).catch(() => null);
  if (!svc || !svc.ok) return "";
  if (svc.data.length === 0)
    return ` No RapidShyp courier serves ${route.pickupPincode} → ${route.deliveryPincode}.`;
  const names = [...new Set(svc.data.map((c) => c.courierName).filter(Boolean))];
  return ` Couriers that serve ${route.pickupPincode} → ${route.deliveryPincode}: ${names.join(", ")} — check they are enabled in RapidShyp's courier priority settings.`;
}

/**
 * Push of a PACKED order to RapidShyp — the real-courier counterpart to
 * schedulePickup's mock-provider flow in order-workflow.ts. Callable by
 * either admin (unscoped — any seller's order) or the seller themselves
 * (pass `scope: { sellerId }`, matching the ownership-scoped/unscoped
 * split order-workflow.ts uses for its own admin vs. seller logistics
 * actions) — a seller-initiated push counts as `LOGISTICS_PROVIDER`
 * exactly like their own mock schedulePickup does, not as `SELLER`
 * acting on their own order. Package dimensions and weight aren't
 * captured anywhere upstream, so they're taken fresh from the caller's
 * form each call (see sendToRapidShypInputSchema).
 *
 * create_order and approve_orders are two SEPARATE RapidShyp API calls —
 * if create_order succeeds but approve_orders (or anything after it)
 * fails, the order already exists on RapidShyp's own dashboard even
 * though nothing was ever written here. A Shipment row is persisted
 * immediately once create_order succeeds (status CREATED, below), before
 * approve_orders is even attempted, specifically so: (a) that RapidShyp
 * order is never invisible/orphaned on our side, and (b) a retry resumes
 * from approve_orders using the same rapidshypOrderId instead of calling
 * create_order again and leaving a silent duplicate on RapidShyp's side.
 * See isResumableRapidShypShipment.
 */
export async function sendSellerOrderToRapidShyp(
  actor: { id: string; role: UserRole },
  input: SendToRapidShypInput,
  scope?: { sellerId: string },
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, ...(scope ? { sellerId: scope.sellerId } : {}) },
    include: {
      items: true,
      shipment: true,
      charge: true,
      pickupPoint: true,
      checkoutGroup: { include: { addressSnapshot: true } },
      paymentAllocations: { include: { payment: true } },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "PACKED")
    return { ok: false, error: "Only a packed order can be sent to RapidShyp." };
  const resumableRapidShypOrderId = isResumableRapidShypShipment(order.shipment)
    ? order.shipment!.rapidshypOrderId
    : null;
  if (order.shipment && !resumableRapidShypOrderId) {
    return { ok: false, error: "A shipment already exists for this order." };
  }
  if (order.deliveryMethod !== "KISAN4U_COURIER")
    return {
      ok: false,
      error: "This order uses a transport partner, not courier delivery — RapidShyp doesn't apply.",
    };
  const address = order.checkoutGroup.addressSnapshot;
  if (!address) return { ok: false, error: "This order has no delivery address on file." };
  const pickupPoint = order.pickupPoint;
  if (!pickupPoint) return { ok: false, error: "This order has no pickup point assigned yet." };
  // Dispatch from the pickup point chosen on the order — registered with
  // RapidShyp on approval, or right here if that attempt failed.
  const pickupLocation = await ensureRapidShypPickupLocation(pickupPoint);
  if (!pickupLocation.ok)
    return {
      ok: false,
      error: `RapidShyp: could not register the "${pickupPoint.name}" pickup point (${pickupLocation.error}).`,
    };
  const rapidshypPickupName = pickupLocation.name;

  const variantIds = order.items
    .map((item) => item.variantId)
    .filter((id): id is string => !!id);
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, length: true, breadth: true, height: true },
      })
    : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  // Same "allocation's share of what's actually been paid" formula as the
  // admin order detail page's own amountPaid calculation, including the
  // same remainingCollectedAmount term (a COD/deferred-ONLINE_PARTIAL
  // balance collected after the original payment attempt) — near-always 0
  // at PACKED/pre-dispatch time, but kept for exact parity with that
  // formula rather than silently dropping a term it accounts for. Needed
  // before orderItems below, since ONLINE_PARTIAL nets it out of what's sent.
  const amountAlreadyPaid = order.paymentAllocations.reduce(
    (total, allocation) =>
      total +
      Number(allocation.amount) *
        (Number(allocation.payment.amountPaid) / Number(allocation.payment.totalAmount || 1)) +
      Number(allocation.remainingCollectedAmount),
    0,
  );

  // OrderItem.subtotal/taxAmount are always GROSS — SellerOrder/OrderItem
  // deliberately never carry any discount (that stays "Kisan4u-borne" so a
  // discount never cuts into the seller's own settlement basis; see
  // checkout-draft.ts's SellerDraft.customerTaxAmount doc). The actual
  // amount the customer is billed (net of whatever discount applied —
  // POS's configurable rate or the web/dealer promo table, before-tax or
  // after depending on which) lives only in OrderCharge.customerPayableTotal.
  const grossMerchandiseAndTax = Number(order.subtotal) + Number(order.taxAmount);
  const netMerchandiseAndTax = order.charge
    ? Number(order.charge.customerPayableTotal) - Number(order.charge.customerPayableDelivery)
    : grossMerchandiseAndTax;
  // RapidShyp has no separate "collect this much delivery charge" field —
  // its total_value is just the sum of orderItems, and prepaidAmount nets
  // off that. So the delivery charge (when the customer, not the seller,
  // owes it) is added below as its own synthetic line item — otherwise
  // RapidShyp is never asked to collect it at all, a real shortfall caught
  // on the Delhivery side for order K4U-20260914-2292-S1 (2026-09-15) and
  // fixed the same way here for consistency. No bifurcation: it's one
  // collectible figure, delivery included.
  const deliveryCharge = order.charge ? Number(order.charge.customerPayableDelivery) : 0;
  const fullOrderValue = round2(netMerchandiseAndTax + deliveryCharge);
  // For ONLINE_PARTIAL the full billed value still goes to RapidShyp as the
  // order value (via the line items below); the amount already collected
  // online is declared separately as `prepaidAmount`, and RapidShyp nets it
  // off to get the COD collectable (total_value − prepaidAmount). Verified
  // live 2026-09-09 (test order K4U-RSTEST-20260909065315, shipment
  // S2609235151): line items worth 1000 + prepaidAmount 300 gave
  // total_value 1000 / collectable_amount 700 on BOTH the approve response
  // and shipment_details — so the declared value stays full (a lost or
  // damaged parcel is claimed against the whole order, not just the COD
  // leg) while the courier collects only the balance. This replaces the
  // earlier workaround of pre-reducing the order total itself, which
  // under-declared the shipment (order K4U-20260826-4229-S1, Aug 2026,
  // when prepaidAmount wasn't yet honored end-to-end on their side).
  // A COD order can be part- or fully paid from the buyer's wallet at
  // checkout, so COD declares what's already paid the same way (0 for a
  // plain COD order — nothing changes there).
  const prepaidAmount =
    order.paymentMethod === "ONLINE_PARTIAL" || order.paymentMethod === "COD"
      ? Math.max(0, Math.min(round2(amountAlreadyPaid), fullOrderValue))
      : 0;
  // Scale every item's gross tax-inclusive price by
  // netMerchandiseAndTax / grossMerchandiseAndTax so the item sum matches
  // the real billed total (net of the Kisan4u-borne discount), without
  // re-deriving the discount math here. The partial-payment reduction is
  // carried by prepaidAmount now, NOT by this ratio.
  const discountScaleRatio =
    grossMerchandiseAndTax > 0 ? netMerchandiseAndTax / grossMerchandiseAndTax : 1;

  const orderItems = order.items.map((item) => {
    const variant = item.variantId ? variantById.get(item.variantId) : undefined;
    // RapidShyp requires unitPrice tax-INCLUSIVE — OrderItem.unitPrice
    // alone is ambiguous (it's the pre-tax price for an
    // EXCLUDE_WITH_PRICE line, but already tax-inclusive for an
    // INCLUDE_WITH_PRICE one — see OrderItem.taxCalcMode's schema doc
    // comment), so it's never used directly here. (item.subtotal +
    // item.taxAmount) is always the gross tax-inclusive line value
    // regardless of taxCalcMode (see money.ts's resolveTaxBreakdown —
    // that's the one invariant it guarantees), then discountScaleRatio
    // nets it down to what's actually billed. The ONLINE_PARTIAL reduction
    // is applied separately via prepaidAmount, not here.
    const grossLineValue = Number(item.subtotal) + Number(item.taxAmount);
    const netLineValue = round2(grossLineValue * discountScaleRatio);
    const unitPrice = item.quantity > 0 ? netLineValue / item.quantity : Number(item.unitPrice);
    // RapidShyp's `tax` sits per-unit alongside unitPrice — same scaling
    // so it stays consistent with the discounted unitPrice above.
    const perUnitTax =
      item.quantity > 0 ? round2(Number(item.taxAmount) * discountScaleRatio) / item.quantity : 0;
    return {
      itemName: item.productName,
      sku: item.sku,
      units: item.quantity,
      unitPrice,
      tax: perUnitTax,
      productWeight: item.unitWeightGrams,
      productLength: metresToCm(variant?.length),
      productBreadth: metresToCm(variant?.breadth),
      productHeight: metresToCm(variant?.height),
    };
  });
  // Declared as its own line item (not RapidShyp's shippingCharges field,
  // whose effect on the collectable total_value isn't verified against
  // their API the way the orderItems-sum path is — see the prepaidAmount
  // comment above for that live confirmation) so it lands in total_value
  // the same proven way every other line item does.
  if (deliveryCharge > 0) {
    orderItems.push({
      itemName: "Delivery Charge",
      sku: "DELIVERY-CHARGE",
      units: 1,
      unitPrice: deliveryCharge,
      tax: 0,
      productWeight: 0,
      productLength: DEFAULT_ITEM_DIM_CM,
      productBreadth: DEFAULT_ITEM_DIM_CM,
      productHeight: DEFAULT_ITEM_DIM_CM,
    });
  }

  // ONLINE_PARTIAL dispatches as COD with prepaidAmount set (below);
  // RapidShyp derives the COD collectable as total_value − prepaidAmount.
  // ("Prepaid amount is only applicable on COD payment mode" per their docs.)
  // A COD or partial-prepaid order the wallet covered in full (the wallet
  // comes off the whole total first, so it can cover a partial order too)
  // has nothing left to collect, so it ships PREPAID (RapidShyp only
  // accepts prepaidAmount on COD mode).
  const codFullyPaidByWallet =
    (order.paymentMethod === "COD" || order.paymentMethod === "ONLINE_PARTIAL") &&
    prepaidAmount >= fullOrderValue - 0.005;
  const paymentMapping: { paymentMethod: "COD" | "PREPAID" } =
    order.paymentMethod === "ONLINE_FULL" ||
    order.paymentMethod === "WALLET" ||
    codFullyPaidByWallet
      ? { paymentMethod: "PREPAID" }
      : { paymentMethod: "COD" };

  const [firstName, ...rest] = address.fullName.trim().split(/\s+/);
  const lastName = rest.join(" ");

  const request: CreateRapidShypOrderRequest = {
    orderId: order.orderNumber,
    orderDate: order.createdAt.toISOString().slice(0, 10),
    storeName: RAPIDSHYP_STORE_NAME,
    billingIsShipping: true,
    shippingAddress: {
      firstName: firstName || address.fullName,
      lastName: lastName || undefined,
      addressLine1: address.line1,
      addressLine2: address.line2 ?? undefined,
      pinCode: address.pincode,
      phone: address.mobile,
    },
    orderItems,
    paymentMethod: paymentMapping.paymentMethod,
    ...(prepaidAmount > 0 && paymentMapping.paymentMethod === "COD" ? { prepaidAmount } : {}),
    packageDetails: {
      packageLength: input.packageLengthCm,
      packageBreadth: input.packageBreadthCm,
      packageHeight: input.packageHeightCm,
      // Entered alongside the dimensions, same as those — package weight
      // isn't captured anywhere upstream either (see the compatibility
      // check that preceded this integration), so it's no longer inferred
      // from summed OrderItem.totalWeightGrams.
      packageWeight: input.packageWeightGrams,
    },
    pickupAddressName: rapidshypPickupName,
  };

  // The Wrapper API bundles create_order + approve_orders + assign_awb +
  // generate_label into this ONE call — replaces the old 4-call sequence
  // (and the "resumable partial-failure" dance that used to sit between
  // create_order and the rest: a preliminary CREATED-status Shipment row
  // written before approve_orders, so a retry could resume with the same
  // rapidshypOrderId instead of leaving a silent duplicate order on
  // RapidShyp's side — see isResumableRapidShypShipment's doc comment for
  // the full history). Confirmed live (2026-09-15, orderId
  // K4U-RSTEST-WRAPPER-IDEMP-53765714) that calling /wrapper twice with the
  // SAME orderId returns the SAME shipmentId/awb both times — RapidShyp
  // treats orderId as an idempotency key here — so a plain retry (same
  // order.orderNumber) is safe on its own without any of that bookkeeping;
  // resumableRapidShypOrderId only matters now for an order that still has
  // an old-style pre-cutover CREATED row sitting from before this change.
  const wrapperResult = await rapidshypCreateWrapperOrder(request);
  let rapidshypOrderId: string;
  let shipmentResult: RapidShypWrapperShipment | undefined;
  let providerResponse: unknown = wrapperResult.raw;
  if (wrapperResult.ok) {
    if (!wrapperResult.data.orderCreated)
      return { ok: false, error: "RapidShyp rejected the order." };
    rapidshypOrderId = resumableRapidShypOrderId ?? wrapperResult.data.rapidshypOrderId;
    shipmentResult = wrapperResult.data.shipments[0];
  } else {
    // The wrapper auto-picks a courier from the account's courier
    // rule/priority and has no field to choose one, so a route served only
    // by a courier outside that rule (K4U-20260923-2622-S1: Jejuri ->
    // Godhra, Blue Dart only) fails the whole call with "Failed to assign
    // courier". Recover by assigning the cheapest serviceable courier
    // explicitly when the failed response still names the created shipment.
    console.error("[rapidshyp-dispatch] wrapper failed", order.orderNumber, JSON.stringify(wrapperResult.raw));
    const route = {
      pickupPincode: pickupPoint.pincode,
      deliveryPincode: address.pincode,
      cod: paymentMapping.paymentMethod === "COD",
      totalOrderValue: Math.max(1, Math.round(fullOrderValue)),
      weight: Math.max(0.5, input.packageWeightGrams / 1000),
    };
    const failedShipmentId = shipmentIdFromWrapperRaw(wrapperResult.raw);
    if (!failedShipmentId) {
      return { ok: false, error: `RapidShyp: ${wrapperResult.error}${await serviceableCourierHint(route)}` };
    }
    const assigned = await rapidshypAssignAwb({ shipmentId: failedShipmentId, fallbackRoute: route });
    if (!assigned.ok) {
      return { ok: false, error: `RapidShyp: ${assigned.error}${await serviceableCourierHint(route)}` };
    }
    const label = await rapidshypGenerateLabel({ shipmentId: failedShipmentId });
    rapidshypOrderId = resumableRapidShypOrderId ?? order.orderNumber;
    shipmentResult = {
      shipmentId: failedShipmentId,
      awb: assigned.data.awb,
      courierName: assigned.data.courierName ?? assigned.data.parentCourierName,
      labelUrl: label.ok ? label.data.labelUrl : undefined,
      labelGenerated: label.ok,
    };
    providerResponse = { wrapper: wrapperResult.raw, assignAwb: assigned.raw, label: label.raw };
  }
  // AWB assignment can fail independently of order creation (courier
  // serviceability, RapidShyp wallet balance, no courier rule on the
  // account) — deliberately non-fatal, same as the old dispatch-time
  // assign_awb: the order IS created on RapidShyp's side by this point, so
  // the shipment is still persisted at PICKUP_SCHEDULED below with a null
  // AWB, and refreshRapidShypTrackingStatus's existing retry path (further
  // down this file) picks it up from there via rapidshypShipmentId.

  const result = await prisma.$transaction(async (tx) => {
    // upsert, not create — a retry of an order that already has an
    // old-style pre-cutover CREATED row (see the comment above) updates it
    // in place instead of erroring on a duplicate sellerOrderId.
    const shipment = await tx.shipment.upsert({
      where: { sellerOrderId: order.id },
      create: {
        sellerOrderId: order.id,
        pickupPointSnapshot: { rapidshypPickupName, name: pickupPoint.name },
        provider: "RAPIDSHYP",
        rapidshypOrderId,
        rapidshypShipmentId: shipmentResult?.shipmentId,
        awbNumber: shipmentResult?.awb ?? null,
        courierName: shipmentResult?.courierName ?? null,
        labelUrl: shipmentResult?.labelUrl ?? null,
        labelFetchedAt: shipmentResult?.labelGenerated ? new Date() : null,
        status: "PICKUP_SCHEDULED",
        lastSyncedAt: new Date(),
      },
      update: {
        rapidshypShipmentId: shipmentResult?.shipmentId,
        awbNumber: shipmentResult?.awb ?? null,
        courierName: shipmentResult?.courierName ?? null,
        labelUrl: shipmentResult?.labelUrl ?? null,
        labelFetchedAt: shipmentResult?.labelGenerated ? new Date() : null,
        status: "PICKUP_SCHEDULED",
        lastSyncedAt: new Date(),
      },
    });
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        status: "PICKUP_SCHEDULED",
        // `request` (packageDetails + per-item dimensions) is logged alongside
        // the response so a mismatch between what was declared and what the
        // provider's dashboard shows later (dimensions, weight) can be traced
        // to our actual outbound payload instead of inferred after the fact —
        // see the K4U-20260915-9488-S1 dimension-mismatch investigation.
        rawProviderResponse: { wrapper: providerResponse, request } as unknown as Prisma.InputJsonValue,
      },
    });
    return recordStatusChange(
      tx,
      order.id,
      order.status,
      "PICKUP_SCHEDULED",
      actor,
      "LOGISTICS_PROVIDER",
      `Sent to RapidShyp (order ${rapidshypOrderId})`,
    );
  });

  if (result.ok) {
    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: "RAPIDSHYP_ORDER_CREATED",
      entityType: "SellerOrder",
      entityId: order.id,
      metadata: { rapidshypOrderId },
    });
    await notifyBuyer({
      customerId: order.customerId,
      title: "Order packed and ready for pickup",
      body: `Your order ${order.orderNumber} has been packed and is ready for pickup.`,
    });
  }
  return result;
}

/**
 * "Pack & send to RapidShyp" — the explicit RapidShyp choice, offered
 * alongside order-workflow.ts's packAndScheduleMockPickup (the manual/mock
 * counterpart) so seller/admin can pick per order which logistics path
 * handles a KISAN4U_COURIER order, while both are tested side by side.
 * TRANSPORT orders never had a RapidShyp option to begin with —
 * sendSellerOrderToRapidShyp's own deliveryMethod guard still applies.
 * Packs first (if not already packed) then dispatches, as one call — same
 * "hide PACKED behind one click" pattern the mock counterpart uses.
 */
export async function packAndSendToRapidShyp(
  actor: { id: string; role: UserRole },
  input: SendToRapidShypInput,
  scope?: { sellerId: string },
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, ...(scope ? { sellerId: scope.sellerId } : {}) },
    select: { status: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  if (order.status === "SELLER_ACCEPTED") {
    const packed = scope
      ? await markPacked(scope.sellerId, actor.id, { sellerOrderId: input.sellerOrderId })
      : await markPackedAsAdmin(actor.id, input.sellerOrderId);
    if (!packed.ok) return packed;
  } else if (order.status !== "PACKED") {
    return { ok: false, error: `Cannot dispatch an order at ${order.status} to RapidShyp.` };
  }

  return sendSellerOrderToRapidShyp(actor, input, scope);
}

/**
 * The 4-step "Create Shipment" dispatch wizard's one server-side action
 * (apps/dashboard's logistics-wizard-modal, launched from the admin and
 * seller order tables). Collapses accept → pack → schedule into a single
 * call: from a CONFIRMED order it accepts with the chosen pickup warehouse,
 * then packs and hands off to the chosen logistics partner
 * (RapidShyp or the manual/mock provider), landing at PICKUP_SCHEDULED.
 * Also usable as a recovery path from SELLER_ACCEPTED/PACKED (skips the
 * accept step). Not transactional across the three sub-steps — each is its
 * own audited transaction, same as markPackedAndReadyForPickup — but every
 * intermediate state is a valid, resumable one.
 */
export async function dispatchOrderViaWizard(
  actor: { id: string; role: UserRole },
  input: DispatchViaWizardInput,
  scope?: { sellerId: string },
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: input.sellerOrderId, ...(scope ? { sellerId: scope.sellerId } : {}) },
    select: {
      status: true,
      deliveryMethod: true,
      shipment: { select: { id: true, provider: true, status: true, awbNumber: true } },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };
  // A RapidShyp order that was created on their side but never finished
  // dispatching (see isResumableRapidShypShipment) must still be allowed
  // through here — sendSellerOrderToRapidShyp resumes it instead of
  // creating a duplicate. Any other existing shipment is a genuine
  // "already dispatched" state.
  if (order.shipment && !isResumableRapidShypShipment(order.shipment)) {
    return { ok: false, error: "A shipment has already been created for this order." };
  }
  if (order.deliveryMethod !== "KISAN4U_COURIER") {
    return { ok: false, error: "The dispatch wizard only applies to Kisan4U Courier orders." };
  }

  if (order.status === "CONFIRMED") {
    const accepted = scope
      ? await acceptOrder(scope.sellerId, actor.id, {
          sellerOrderId: input.sellerOrderId,
          pickupPointId: input.pickupPointId,
        })
      : await acceptOrderAsAdmin(actor.id, {
          sellerOrderId: input.sellerOrderId,
          pickupPointId: input.pickupPointId,
        });
    if (!accepted.ok) return accepted;
  } else if (order.status !== "SELLER_ACCEPTED" && order.status !== "PACKED") {
    return { ok: false, error: `This order is at ${order.status} and can't be dispatched from here.` };
  }

  const dims = {
    sellerOrderId: input.sellerOrderId,
    packageLengthCm: input.packageLengthCm,
    packageBreadthCm: input.packageBreadthCm,
    packageHeightCm: input.packageHeightCm,
    packageWeightGrams: input.packageWeightGrams,
  };
  if (input.partner === "RAPIDSHYP") return packAndSendToRapidShyp(actor, dims, scope);
  if (input.partner === "DELHIVERY") {
    if (!input.delhiveryAccount) return { ok: false, error: "Choose a Delhivery account." };
    return packAndSendToDelhivery(actor, { ...dims, delhiveryAccount: input.delhiveryAccount }, scope);
  }
  return packAndScheduleMockPickup(actor, input.sellerOrderId, scope);
}

/**
 * Admin-triggered pull of live status from RapidShyp for an order already
 * pushed there. Always refreshes the display fields on Shipment; only
 * attempts an OrderStatus transition for RapidShyp's forward-progress
 * codes (RAPIDSHYP_FORWARD_STATUS_MAP) — see that map's doc comment for
 * why RTO/exception codes are display-only.
 */
export async function refreshRapidShypTrackingStatus(
  adminUserId: string,
  sellerOrderId: string,
): Promise<WorkflowResult> {
  const order = await prisma.sellerOrder.findFirst({
    where: { id: sellerOrderId },
    include: { shipment: true, checkoutGroup: { include: { addressSnapshot: true } } },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.shipment || order.shipment.provider !== "RAPIDSHYP" || !order.shipment.rapidshypOrderId)
    return { ok: false, error: "This order has no RapidShyp shipment to refresh." };

  // If the AWB was never assigned, retry it now. Dispatch-time assign_awb
  // is non-fatal (it can fail on courier serviceability, RapidShyp wallet
  // balance, or a missing courier rule), so this is the path that lets a
  // shipment pick up its AWB + courier + label once that underlying issue
  // is fixed — no re-dispatch needed. On failure it surfaces the real
  // reason instead of the misleading "tracking data not found" that
  // track_order returns for an AWB-less order.
  let effectiveAwb = order.shipment.awbNumber;
  let effectiveCourier = order.shipment.courierName;
  if (order.shipment.rapidshypShipmentId && !effectiveAwb) {
    // Same serviceability-backed fallback the dispatch path uses (see
    // sendSellerOrderToRapidShyp) so a retry can get past "Failed to
    // assign courier" caused by no courier rule on the account.
    const details = await rapidshypGetShipmentDetails(order.shipment.rapidshypShipmentId);
    const deliveryPincode = order.checkoutGroup?.addressSnapshot?.pincode;
    const fallbackRoute =
      details.ok && details.data.warehousePincode && deliveryPincode
        ? {
            pickupPincode: details.data.warehousePincode,
            deliveryPincode,
            cod: order.paymentMethod === "COD" || order.paymentMethod === "ONLINE_PARTIAL",
            totalOrderValue: Math.max(1, Math.round(Number(order.totalAmount))),
            weight: Math.max(0.5, (details.data.deadWeightGrams ?? 1000) / 1000),
          }
        : undefined;
    const assigned = await rapidshypAssignAwb({
      shipmentId: order.shipment.rapidshypShipmentId,
      fallbackRoute,
    });
    if (!assigned.ok) return { ok: false, error: `RapidShyp: ${assigned.error}` };
    effectiveAwb = assigned.data.awb;
    effectiveCourier = assigned.data.courierName ?? effectiveCourier;
    await prisma.shipment.update({
      where: { id: order.shipment.id },
      data: { awbNumber: effectiveAwb, courierName: effectiveCourier, lastSyncedAt: new Date() },
    });
  }

  // Fetch + store the shipping-label PDF URL the moment an AWB exists but
  // none is stored yet (dispatch-time generate_label failed, the AWB was
  // just assigned above, or RapidShyp assigned it asynchronously). Runs
  // before the tracking call so a shipment whose tracking "data not found"
  // — normal until a courier picks it up — still gets its label.
  // Best-effort: never fails the sync.
  if (order.shipment.rapidshypShipmentId && effectiveAwb && !order.shipment.labelUrl) {
    const label = await rapidshypGenerateLabel({
      shipmentId: order.shipment.rapidshypShipmentId,
    });
    if (label.ok) {
      await prisma.shipment.update({
        where: { id: order.shipment.id },
        data: { labelUrl: label.data.labelUrl, labelFetchedAt: new Date() },
      });
    }
  }

  const tracked = await rapidshypTrackOrder({ orderId: order.shipment.rapidshypOrderId });
  if (!tracked.ok) {
    // "Tracking data not found" is normal between dispatch and the
    // courier's first scan — RapidShyp simply has no tracking record yet.
    // The bulk poller already treats it as a no-op; a manual refresh
    // shouldn't surface it as an error either. Stamp lastSyncedAt so the
    // panel shows the refresh ran, and surface anything else as a failure.
    if (tracked.error.includes("Tracking data not found")) {
      await prisma.shipment.update({
        where: { id: order.shipment.id },
        data: { lastSyncedAt: new Date() },
      });
      return { ok: true };
    }
    return { ok: false, error: `RapidShyp: ${tracked.error}` };
  }

  const shipmentDetail = tracked.data.shipment;
  const newCode = shipmentDetail?.statusCode;
  const codeChanged = !!newCode && newCode !== order.shipment.trackingStatusCode;

  await prisma.shipment.update({
    where: { id: order.shipment.id },
    data: {
      courierName: shipmentDetail?.courierName ?? effectiveCourier,
      trackingStatusCode: shipmentDetail?.statusCode ?? order.shipment.trackingStatusCode,
      trackingStatusDesc: shipmentDetail?.statusDesc ?? order.shipment.trackingStatusDesc,
      awbNumber: shipmentDetail?.awb ?? effectiveAwb,
      lastSyncedAt: new Date(),
    },
  });

  const forwardStatus = newCode ? resolveRapidShypForwardStatus(newCode) : undefined;
  // Repeat poll of an RTO / failed-delivery state the order is already in —
  // not a new event (see refreshDelhiveryTrackingStatus); falls through to
  // the informational row below, which only fires if the code moved.
  if (forwardStatus && !isRepeatOfCurrentShipmentStatus(order.status, forwardStatus)) {
    return advanceShipmentToStatus(
      order as SellerOrderWithShipment,
      { id: adminUserId, role: "ADMIN" },
      forwardStatus,
      tracked.raw as Record<string, unknown>,
      shipmentDetail?.statusDesc,
      { code: newCode, desc: shipmentDetail?.statusDesc },
    );
  }

  // Informational-only: a code RapidShyp sent (on-hold, RTO, damage,
  // courier-side cancellation, or anything unrecognized — see
  // RAPIDSHYP_FORWARD_STATUS_MAP's doc comment) that doesn't drive an
  // OrderStatus/ShipmentStatus transition. Still worth a permanent
  // ShipmentStatusHistory row: without this, only the LATEST such code
  // survives (Shipment's own display fields get overwritten every poll),
  // and the tracking flow chart would silently skip every one of these
  // events instead of showing what actually happened.
  if (codeChanged) {
    await prisma.shipmentStatusHistory.create({
      data: {
        shipmentId: order.shipment.id,
        status: null,
        courierStatusCode: newCode,
        courierStatusDesc: shipmentDetail?.statusDesc,
        rawProviderResponse: tracked.raw as Prisma.InputJsonValue,
      },
    });
  }

  return { ok: true };
}

// There's no push/webhook API on RapidShyp's side (checked their full
// published API surface — Tracking is pull-only), so staying current
// means polling. Runs unattended (see instrumentation.ts), so the actor
// is synthetic rather than a real admin — matches the ADMIN role
// refreshRapidShypTrackingStatus already hardcodes for its own
// auto-advance, and actorId on OrderStatusHistory is a plain string, not
// an FK, so this doesn't need to resolve to a real user.
const RAPIDSHYP_POLLER_ACTOR_ID = "system:rapidshyp-tracking-poller";

export interface RapidShypPollSummary {
  checked: number;
  // Polled successfully — display fields refreshed and any due
  // OrderStatus transition applied. Not necessarily an actual status
  // change: most polls just confirm nothing new happened yet.
  succeeded: number;
  errors: { sellerOrderId: string; error: string }[];
}

/**
 * Bulk counterpart to refreshRapidShypTrackingStatus for every order
 * still in flight — called on a timer (instrumentation.ts), not per
 * click. "Tracking data not found" from RapidShyp is expected and
 * common here (an order sits with no AWB from approval until a courier
 * actually picks it up — same gap manual refresh already tolerates) so
 * it's treated as a normal no-op poll, not a failure worth surfacing.
 */
export async function pollActiveRapidShypShipments(): Promise<RapidShypPollSummary> {
  const shipments = await prisma.shipment.findMany({
    where: {
      provider: "RAPIDSHYP",
      // DELIVERY_FAILED stays polled: a failed attempt is usually
      // re-attempted, then delivered or sent back (RTO).
      status: { notIn: ["DELIVERED", "RTO_DELIVERED_TO_SELLER"] },
    },
    select: { sellerOrderId: true },
  });

  const summary: RapidShypPollSummary = { checked: 0, succeeded: 0, errors: [] };
  for (const { sellerOrderId } of shipments) {
    summary.checked += 1;
    const result = await refreshRapidShypTrackingStatus(RAPIDSHYP_POLLER_ACTOR_ID, sellerOrderId);
    if (result.ok) {
      summary.succeeded += 1;
    } else if (!result.error.includes("Tracking data not found")) {
      summary.errors.push({ sellerOrderId, error: result.error });
    }
  }
  return summary;
}
