import { api } from "@/lib/api-client";
import type { CartDTO } from "./types";

export function getCart() {
  return api.get<CartDTO>("/api/mobile/v1/cart");
}

export function addToCart(input: { productId: string; variantId?: string; quantity: number }) {
  return api.post<{ cartItemId: string }>("/api/mobile/v1/cart", input);
}

export function updateCartItemQuantity(cartItemId: string, quantity: number) {
  return api.patch<{ cartItemId: string }>(`/api/mobile/v1/cart/${cartItemId}`, { quantity });
}

export function removeCartItem(cartItemId: string) {
  return api.delete<{ cartItemId: string }>(`/api/mobile/v1/cart/${cartItemId}`);
}
