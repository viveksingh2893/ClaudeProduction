import * as FileSystem from "expo-file-system/legacy";
import { api, API_BASE_URL } from "@/lib/api-client";
import { getStoredTokens } from "@/lib/secure-storage";
import type {
  DealerProductDTO,
  DealerProfileDTO,
  LineEligibility,
  ProductRequestDTO,
} from "./types";

// --- Registration -----------------------------------------------------------

export function requestDealerRegistrationOtp(phone: string) {
  return api.post<{ phone: string; alreadyDealer: boolean }>(
    "/api/mobile/v1/dealer/register/otp/request",
    { phone },
    { auth: false },
  );
}

export function verifyDealerRegistrationOtp(phone: string, code: string) {
  return api.post<{ alreadyDealer: boolean; phone?: string; onboardingSessionId?: string }>(
    "/api/mobile/v1/dealer/register/otp/verify",
    { phone, code },
    { auth: false },
  );
}

export type DealerRegistrationInput = {
  onboardingSessionId: string;
  name: string;
  storeName: string;
  storeAddress: string;
  city: string;
  stateId: string;
  pincode: string;
  gstNumber?: string;
  licenseNumber: string;
  gstDocUrl?: string;
  licenseDocUrl: string;
};

export function submitDealerRegistration(input: DealerRegistrationInput) {
  return api.post<{ dealerProfileId: string; statusViewSessionId: string }>(
    "/api/mobile/v1/dealer/register",
    input,
    {
      auth: false,
    },
  );
}

// --- "Become a Dealer" for an existing signed-in customer ------------------

export type DealerApplicationFormDTO = {
  name: string;
  storeName: string;
  storeAddress: string;
  city: string;
  stateId: string;
  pincode: string;
  gstNumber: string;
  licenseNumber: string;
  gstDocUrl: string;
  licenseDocUrl: string;
};

export type DealerApplicationStatusDTO = {
  status: string;
  kycStatus: string;
  rejectionReason: string | null;
  hasPendingChanges: boolean;
};

/** Current application status + a prefill of the form for the signed-in user. */
export function getDealerApplication() {
  return api.get<{
    application: DealerApplicationStatusDTO | null;
    form: DealerApplicationFormDTO;
  }>("/api/mobile/v1/dealer/application");
}

export type PickedDocument = { uri: string; name: string; mimeType: string };
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Streams a picked file to a multipart endpoint via
 * FileSystem.uploadAsync — far more reliable on Android than
 * `fetch(new FormData())` with a `{uri,name,type}` part, which silently
 * fails for `content://` / cache URIs on RN 0.86 (the cause of the
 * "can't upload GST / licence copy" bug). `extraFields` carries the
 * onboarding-session id for the signed-out registration flow.
 */
export async function uploadFile(
  endpoint: string,
  doc: PickedDocument,
  opts: { auth?: boolean; extraFields?: Record<string, string> } = {},
): Promise<UploadResult> {
  if (!API_BASE_URL) return { ok: false, error: "App is misconfigured (no API URL)." };

  const headers: Record<string, string> = {};
  if (opts.auth) {
    const tokens = await getStoredTokens();
    if (!tokens) return { ok: false, error: "Please log in again." };
    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  let res: FileSystem.FileSystemUploadResult;
  try {
    res = await FileSystem.uploadAsync(`${API_BASE_URL}${endpoint}`, doc.uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: doc.mimeType,
      parameters: opts.extraFields,
      headers,
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }

  const json = (() => {
    try {
      return JSON.parse(res.body) as { ok?: boolean; data?: { url?: string }; error?: { message?: string } };
    } catch {
      return null;
    }
  })();
  if (res.status < 200 || res.status >= 300 || !json?.ok || !json.data?.url) {
    return { ok: false, error: json?.error?.message ?? `Upload failed (${res.status}).` };
  }
  return { ok: true, url: json.data.url };
}

/** GST / licence document upload for the signed-in "Become a Dealer" form. */
export function uploadDealerDocument(doc: PickedDocument): Promise<UploadResult> {
  return uploadFile("/api/mobile/v1/dealer/documents", doc, { auth: true });
}

/** GST / licence document upload during the signed-out dealer-registration flow. */
export function uploadDealerRegistrationDocument(
  onboardingSessionId: string,
  doc: PickedDocument,
): Promise<UploadResult> {
  return uploadFile("/api/mobile/v1/dealer/register/documents", doc, {
    extraFields: { onboardingSessionId },
  });
}

/** Submit or resubmit (PENDING / REJECTED) the caller's dealer application. */
export function submitDealerApplication(input: {
  name: string;
  storeName: string;
  storeAddress: string;
  city: string;
  stateId: string;
  pincode: string;
  gstNumber?: string;
  licenseNumber?: string;
  gstDocUrl?: string;
  licenseDocUrl?: string;
}) {
  return api.post<{ profileId: string; resubmitted: boolean }>(
    "/api/mobile/v1/dealer/application",
    input,
  );
}

export function getDealerStatus(statusViewSessionId?: string) {
  const suffix = statusViewSessionId
    ? `?statusViewSessionId=${encodeURIComponent(statusViewSessionId)}`
    : "";
  return api.get<{ profile: DealerProfileDTO }>(`/api/mobile/v1/dealer/status${suffix}`, {
    auth: !statusViewSessionId,
  });
}

// --- Catalogue ---------------------------------------------------------------

export function getDealerProducts(params: {
  category?: string;
  subCategory?: string;
  subSubCategory?: string;
  brand?: string;
  crop?: string;
  pest?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return api.get<{
    items: DealerProductDTO[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }>(`/api/mobile/v1/dealer/products${suffix}`);
}

export function getDealerProduct(id: string) {
  return api.get<{
    product: DealerProductDTO;
    baseEligibility: LineEligibility | null;
    variantEligibilities: LineEligibility[];
  }>(`/api/mobile/v1/dealer/products/${id}`);
}

// --- Product requests ("Request Seller") -------------------------------------

export function getDealerRequests() {
  return api.get<{ requests: ProductRequestDTO[] }>("/api/mobile/v1/dealer/requests");
}

export function createProductRequest(input: {
  productId: string;
  variantId?: string;
  quantity: number;
  deliveryAddress: string;
  deliveryStateId: string;
  note?: string;
}) {
  return api.post<{ requestId: string }>("/api/mobile/v1/dealer/requests", input);
}

export function cancelProductRequest(id: string) {
  return api.post<{ ok: true }>(`/api/mobile/v1/dealer/requests/${id}/cancel`);
}
