import { api } from "@/lib/api-client";
import type { DealerProductDTO, CustomerProductDTO } from "./types";

export function getWishlist() {
  return api.get<{ products: (CustomerProductDTO | DealerProductDTO)[] }>("/api/mobile/v1/wishlist");
}

export function toggleWishlist(productId: string) {
  return api.post<{ wishlisted: boolean }>(`/api/mobile/v1/wishlist/${productId}`);
}
