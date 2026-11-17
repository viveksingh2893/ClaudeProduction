import { api, API_BASE_URL } from "@/lib/api-client";
import { getStoredTokens } from "@/lib/secure-storage";
import type {
  CheckoutGroupDTO,
  RefundMethod,
  SellerOrderDTO,
} from "./types";

export function getOrderGroups() {
  return api.get<{ groups: CheckoutGroupDTO[] }>("/api/mobile/v1/orders");
}

export function getOrderGroup(groupId: string) {
  return api.get<{ group: CheckoutGroupDTO }>(`/api/mobile/v1/orders/${groupId}`);
}

export function getSellerOrder(groupId: string, sellerOrderId: string) {
  return api.get<{ order: SellerOrderDTO }>(`/api/mobile/v1/orders/${groupId}/${sellerOrderId}`);
}

/**
 * Cancel a seller order. `instant` (still-"Pending" order) cancels outright;
 * otherwise it's a request the Kisan4U team reviews. `refundMethod` is only
 * needed when real non-wallet money was already captured — the server
 * re-checks and ignores it otherwise.
 */
export function cancelOrder(
  groupId: string,
  sellerOrderId: string,
  input: { reason: string; refundMethod?: "WALLET" | "ORIGINAL_SOURCE"; instant?: boolean },
) {
  return api.post<{ ok: true }>(
    `/api/mobile/v1/orders/${groupId}/${sellerOrderId}/cancel`,
    input,
  );
}

export type RequestReturnBody = {
  reason: string;
  imageUrls: string[];
  videoUrl?: string;
  refundMethod: RefundMethod;
  bankAccountHolderName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
};

/** Per-item post-delivery return request. Photos/video must be uploaded first via uploadReturnMedia. */
export function requestReturn(
  groupId: string,
  sellerOrderId: string,
  orderItemId: string,
  body: RequestReturnBody,
) {
  return api.post<{ ok: true }>(
    `/api/mobile/v1/orders/${groupId}/${sellerOrderId}/items/${orderItemId}/return`,
    body,
  );
}

export type PickedMedia = { uri: string; name: string; mimeType: string };

/**
 * Upload one return-evidence file (photo or the optional video) and get
 * back its stored URL. multipart/form-data — bypasses the JSON `api`
 * client but still bearer-authenticated, same pattern as
 * uploadDealerDocument.
 */
export async function uploadReturnMedia(
  groupId: string,
  sellerOrderId: string,
  orderItemId: string,
  kind: "image" | "video",
  file: PickedMedia,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!API_BASE_URL) return { ok: false, error: "App is misconfigured (no API URL)." };
  const tokens = await getStoredTokens();
  if (!tokens) return { ok: false, error: "Please log in again." };

  const body = new FormData();
  // React Native's FormData accepts this {uri,name,type} shape for a file part.
  body.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE_URL}/api/mobile/v1/orders/${groupId}/${sellerOrderId}/items/${orderItemId}/return-media?kind=${kind}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        body,
      },
    );
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: { url: string }; error?: { message: string } }
    | null;
  if (!res.ok || !json?.ok || !json.data?.url) {
    return { ok: false, error: json?.error?.message ?? `Upload failed (${res.status}).` };
  }
  return { ok: true, url: json.data.url };
}
