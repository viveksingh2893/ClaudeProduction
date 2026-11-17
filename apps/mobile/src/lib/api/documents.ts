import { Linking } from "react-native";
import { api } from "@/lib/api-client";

export async function openPrivateDocument(
  field: "dealer-gst" | "dealer-licence" | "seller-gst" | "seller-pan" | "ba-pan" | "ba-cheque",
) {
  const result = await api.post<{ url: string; expiresAt: string }>(
    `/api/mobile/v1/documents/${field}`,
  );
  if (!result.ok) return result;
  await Linking.openURL(result.data.url);
  return result;
}
