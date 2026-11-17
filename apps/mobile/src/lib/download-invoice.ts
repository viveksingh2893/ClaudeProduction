import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "@/lib/api-client";
import { getStoredTokens } from "@/lib/secure-storage";

/**
 * Downloads a seller order's invoice PDF (bearer-authenticated) into the
 * app cache, then hands it to the OS share sheet — "Save to Files", print,
 * mail, Drive, etc. Sharing needs the FileProvider that the `expo-sharing`
 * config plugin adds to the Android manifest.
 */
export async function downloadInvoice(
  groupId: string,
  sellerOrderId: string,
  invoiceNumber?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!API_BASE_URL) return { ok: false, error: "App is misconfigured." };
  const tokens = await getStoredTokens();
  if (!tokens) return { ok: false, error: "Please log in again." };

  const safe = (invoiceNumber || sellerOrderId).replace(/[^A-Za-z0-9_-]/g, "-");
  const target = `${FileSystem.cacheDirectory}invoice-${safe}.pdf`;
  const url = `${API_BASE_URL}/api/mobile/v1/orders/${groupId}/${sellerOrderId}/invoice`;

  try {
    const res = await FileSystem.downloadAsync(url, target, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (res.status !== 200) {
      return { ok: false, error: `Couldn't fetch the invoice (${res.status}).` };
    }
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: "Sharing isn't available on this device." };
    }
    await Sharing.shareAsync(res.uri, {
      mimeType: "application/pdf",
      dialogTitle: `Invoice ${invoiceNumber ?? ""}`.trim(),
      UTI: "com.adobe.pdf",
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't download the invoice." };
  }
}
