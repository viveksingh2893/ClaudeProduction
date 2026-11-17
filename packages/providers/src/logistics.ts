/**
 * Mock logistics/courier provider (Phase 4). Kept mocked per the original
 * MVP-phase constraint (no real courier API during the initial build) —
 * this interface exists so a real provider can be added later without
 * redesigning packages/orders' shipment handling, which is exactly what
 * happened: RapidShyp (rapidshyp.ts) is now a real, live courier
 * integration for admin-initiated dispatch. This mock stays in place for
 * the seller-driven pickup-scheduling flow (schedulePickup in
 * order-workflow.ts) that hasn't been migrated to a real provider.
 *
 * Zero dependency on @kisan4u/db, same reasoning as payment.ts: this
 * package only ever receives plain values from the caller.
 */
export type MockShipmentEvent =
  "PICKUP_SCHEDULED" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "DELIVERY_FAILED";

export interface CreateShipmentRequest {
  /** SellerOrder.orderNumber — a safe, customer-facing reference, never a raw database id. */
  sellerOrderReference: string;
  originPincode: string;
  destinationPincode: string;
  weightGrams: number;
  packageCount?: number;
}

export interface CreateShipmentResult {
  awbNumber: string;
  rawResponse: Record<string, unknown>;
}

export interface ShipmentStatusUpdateResult {
  status: MockShipmentEvent;
  rawResponse: Record<string, unknown>;
}

export interface LogisticsProvider {
  createShipment(request: CreateShipmentRequest): Promise<CreateShipmentResult>;
  schedulePickup(awbNumber: string): Promise<ShipmentStatusUpdateResult>;
  markPickedUp(awbNumber: string): Promise<ShipmentStatusUpdateResult>;
  markInTransit(awbNumber: string): Promise<ShipmentStatusUpdateResult>;
  markDelivered(awbNumber: string): Promise<ShipmentStatusUpdateResult>;
  markDeliveryFailed(awbNumber: string, reason?: string): Promise<ShipmentStatusUpdateResult>;
}

function mockAwbNumber(): string {
  return `MOCKAWB${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function event(
  status: MockShipmentEvent,
  extra?: Record<string, unknown>,
): ShipmentStatusUpdateResult {
  const rawResponse = { event: status, at: new Date().toISOString(), ...extra };
  console.log(`[mock-logistics] ${status}`, rawResponse);
  return { status, rawResponse };
}

export const mockLogisticsProvider: LogisticsProvider = {
  async createShipment(request) {
    const awbNumber = mockAwbNumber();
    const rawResponse = {
      event: "SHIPMENT_CREATED",
      awbNumber,
      ...request,
      at: new Date().toISOString(),
    };
    console.log(
      `[mock-logistics] createShipment ref=${request.sellerOrderReference} awb=${awbNumber}`,
    );
    return { awbNumber, rawResponse };
  },
  async schedulePickup(awbNumber) {
    return event("PICKUP_SCHEDULED", { awbNumber });
  },
  async markPickedUp(awbNumber) {
    return event("PICKED_UP", { awbNumber });
  },
  async markInTransit(awbNumber) {
    return event("IN_TRANSIT", { awbNumber });
  },
  async markDelivered(awbNumber) {
    return event("DELIVERED", { awbNumber });
  },
  async markDeliveryFailed(awbNumber, reason) {
    return event("DELIVERY_FAILED", { awbNumber, reason });
  },
};
