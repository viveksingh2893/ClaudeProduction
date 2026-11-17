import { api } from "@/lib/api-client";
import type { SellerOrderDTO } from "./types";

export function getSellerOrders(status?: string) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return api.get<{ orders: SellerOrderDTO[] }>(`/api/mobile/v1/seller/orders${suffix}`);
}

export function getSellerOrder(id: string) {
  return api.get<{ order: SellerOrderDTO }>(`/api/mobile/v1/seller/orders/${id}`);
}

export type SellerOrderAction =
  | { action: "ACCEPT"; pickupPointId: string }
  | { action: "PACK"; packageCount?: number }
  | { action: "SCHEDULE_PICKUP" }
  | { action: "PICKED_UP" }
  | { action: "IN_TRANSIT" }
  | { action: "DELIVERED" }
  | { action: "DELIVERY_FAILED"; reason: string }
  | { action: "REJECT"; reason: string };

export function updateSellerOrderStatus(sellerOrderId: string, body: SellerOrderAction) {
  return api.post<{ ok: true }>(`/api/mobile/v1/seller/orders/${sellerOrderId}/status`, body);
}

export function getSellerProducts() {
  return api.get<{ products: unknown[] }>("/api/mobile/v1/seller/products");
}

export function getSellerPickupPoints() {
  return api.get<{ points: { id: string; name: string; isDefault: boolean }[] }>(
    "/api/mobile/v1/seller/pickup-points",
  );
}
