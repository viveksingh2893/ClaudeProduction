import { api } from "@/lib/api-client";
import type { AddressDTO } from "./types";

export function getAddresses() {
  return api.get<{ addresses: AddressDTO[] }>("/api/mobile/v1/addresses");
}

export type AddressInput = Omit<AddressDTO, "id" | "isDefault"> & { isDefault?: boolean };

export function createAddress(input: AddressInput) {
  return api.post<AddressDTO>("/api/mobile/v1/addresses", input);
}

export function updateAddress(id: string, input: AddressInput) {
  return api.patch<AddressDTO>(`/api/mobile/v1/addresses/${id}`, input);
}

export function deleteAddress(id: string) {
  return api.delete<{ ok: true }>(`/api/mobile/v1/addresses/${id}`);
}

export function setDefaultAddress(id: string) {
  return api.post<{ ok: true }>(`/api/mobile/v1/addresses/${id}/default`);
}
