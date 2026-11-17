import { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AppText, Button, SelectField, TextField } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/context/toast-context";
import {
  requestReturn,
  uploadReturnMedia,
  type PickedMedia,
  type RequestReturnBody,
} from "@/lib/api/orders";
import type { RefundMethod } from "@/lib/api/types";
import { Radius, Spacing } from "@/constants/theme";

const MAX_IMAGES = 6;

/**
 * Per-item return request — the app mirror of apps/web's
 * request-return-button.tsx. At least one photo is mandatory, one video is
 * optional; both upload immediately on pick (never held as blobs across
 * submit). WALLET is always offered; "Same account I paid with"
 * (ORIGINAL_SOURCE) only for a prepaid order; "Bank account"
 * (BANK_TRANSFER) only for COD, with the account fields. requestReturn on
 * the server is the real authority — this just shapes the input.
 */
export function ReturnRequestForm({
  groupId,
  sellerOrderId,
  orderItemId,
  paymentMethod,
  onCancel,
  onDone,
}: {
  groupId: string;
  sellerOrderId: string;
  orderItemId: string;
  paymentMethod: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const isCod = paymentMethod === "COD";

  const [reason, setReason] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(
    isCod ? "BANK_TRANSFER" : "WALLET",
  );
  const [bankAccountHolderName, setHolder] = useState("");
  const [bankAccountNumber, setAccountNumber] = useState("");
  const [bankIfsc, setIfsc] = useState("");

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refundOptions = useMemo(
    () => [
      { label: "Kisan4U Wallet", value: "WALLET" },
      ...(isCod
        ? [{ label: "Bank account", value: "BANK_TRANSFER" }]
        : [{ label: "Same account I paid with", value: "ORIGINAL_SOURCE" }]),
    ],
    [isCod],
  );

  async function pickAndUpload(source: "camera" | "library", kind: "image" | "video") {
    setError(null);
    if (kind === "image" && imageUrls.length >= MAX_IMAGES) {
      setError(`You can attach up to ${MAX_IMAGES} photos.`);
      return;
    }
    const perm =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(
        source === "camera"
          ? "Camera permission is needed to take a photo."
          : "Photo library permission is needed.",
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: kind === "image" ? ["images"] : ["videos"],
      quality: 0.7,
      allowsMultipleSelection: kind === "image" && source === "library",
      selectionLimit: kind === "image" ? MAX_IMAGES - imageUrls.length : 1,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || result.assets.length === 0) return;

    setUploading(true);
    try {
      for (const asset of result.assets) {
        const picked = toPickedMedia(asset, kind);
        const up = await uploadReturnMedia(groupId, sellerOrderId, orderItemId, kind, picked);
        if (!up.ok) {
          setError(up.error);
          continue;
        }
        if (kind === "image") setImageUrls((prev) => [...prev, up.url]);
        else setVideoUrl(up.url);
      }
    } finally {
      setUploading(false);
    }
  }

  function removeImage(url: string) {
    setImageUrls((prev) => prev.filter((u) => u !== url));
  }

  async function submit() {
    setError(null);
    if (reason.trim().length < 3) {
      setError("Add a short reason for the return.");
      return;
    }
    if (imageUrls.length === 0) {
      setError("Add at least one photo of the item.");
      return;
    }
    const body: RequestReturnBody = {
      reason: reason.trim(),
      imageUrls,
      videoUrl: videoUrl ?? undefined,
      refundMethod,
      ...(refundMethod === "BANK_TRANSFER"
        ? { bankAccountHolderName, bankAccountNumber, bankIfsc }
        : {}),
    };
    setSubmitting(true);
    const res = await requestReturn(groupId, sellerOrderId, orderItemId, body);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    toast.success("Return request submitted");
    onDone();
  }

  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <AppText variant="subtitle">Request a return</AppText>

      <TextField
        label="Reason for return"
        value={reason}
        onChangeText={setReason}
        placeholder="Tell us what's wrong with the item"
        multiline
      />

      <View style={styles.field}>
        <AppText variant="label" color="secondary">
          Photos of the item (required)
        </AppText>
        <View style={styles.thumbRow}>
          {imageUrls.map((url) => (
            <View key={url} style={[styles.thumb, { borderColor: theme.border }]}>
              <Image source={{ uri: mediaSrc(url) }} style={styles.thumbImg} resizeMode="cover" />
              <Pressable
                onPress={() => removeImage(url)}
                hitSlop={8}
                style={[styles.thumbRemove, { backgroundColor: theme.ink }]}
                accessibilityLabel="Remove photo"
              >
                <Ionicons name="close" size={13} color={theme.onGreen} />
              </Pressable>
            </View>
          ))}
          {imageUrls.length < MAX_IMAGES ? (
            <Pressable
              onPress={() => pickAndUpload("camera", "image")}
              onLongPress={() => pickAndUpload("library", "image")}
              disabled={uploading}
              style={[styles.addTile, { borderColor: theme.border }]}
              accessibilityLabel="Add photo — tap for camera, long-press for gallery"
            >
              <Ionicons name="camera-outline" size={20} color={theme.green700} />
              <AppText variant="caption" color="secondary">
                {uploading ? "…" : "Add"}
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <AppText variant="caption" color="secondary">
          Tap to use the camera, long-press to pick from the gallery. JPEG/PNG/WEBP, up to{" "}
          {MAX_IMAGES}.
        </AppText>
      </View>

      <View style={styles.field}>
        <AppText variant="label" color="secondary">
          Video (optional)
        </AppText>
        {videoUrl ? (
          <View style={[styles.videoRow, { borderColor: theme.border }]}>
            <Ionicons name="videocam" size={18} color={theme.green700} />
            <AppText variant="body" style={{ flex: 1 }} numberOfLines={1}>
              Video attached
            </AppText>
            <Pressable onPress={() => setVideoUrl(null)} hitSlop={8} accessibilityLabel="Remove video">
              <Ionicons name="close" size={18} color={theme.danger} />
            </Pressable>
          </View>
        ) : (
          <Button
            label={uploading ? "Uploading…" : "Add a video"}
            variant="outline"
            onPress={() => pickAndUpload("library", "video")}
            disabled={uploading}
          />
        )}
        <AppText variant="caption" color="secondary">
          MP4, WEBM or MOV, up to 25MB.
        </AppText>
      </View>

      <SelectField
        label="Refund to"
        value={refundMethod}
        options={refundOptions}
        onChange={(v) => setRefundMethod(v as RefundMethod)}
      />

      {refundMethod === "BANK_TRANSFER" ? (
        <View style={[styles.bankBox, { borderColor: theme.border }]}>
          <TextField
            label="Account holder name"
            value={bankAccountHolderName}
            onChangeText={setHolder}
          />
          <TextField
            label="Account number"
            value={bankAccountNumber}
            onChangeText={setAccountNumber}
            keyboardType="number-pad"
          />
          <TextField
            label="IFSC code"
            value={bankIfsc}
            onChangeText={(t) => setIfsc(t.toUpperCase())}
            autoCapitalize="characters"
          />
        </View>
      ) : null}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}

      <Button
        label="Submit return request"
        variant="primary"
        onPress={submit}
        loading={submitting}
        disabled={uploading}
      />
      <Button label="Never mind" variant="ghost" onPress={onCancel} disabled={submitting} />
    </View>
  );
}

/** `/api/uploads/...` paths are served off the same host as the API. */
function mediaSrc(url: string): string {
  if (url.startsWith("http")) return url;
  const base = process.env.EXPO_PUBLIC_API_URL ?? "";
  return `${base}${url}`;
}

function toPickedMedia(
  asset: ImagePicker.ImagePickerAsset,
  kind: "image" | "video",
): PickedMedia {
  const uri = asset.uri;
  const extFromUri = uri.split(".").pop()?.toLowerCase() ?? "";
  const fallbackMime =
    kind === "image"
      ? extFromUri === "png"
        ? "image/png"
        : extFromUri === "webp"
          ? "image/webp"
          : "image/jpeg"
      : extFromUri === "webm"
        ? "video/webm"
        : extFromUri === "mov"
          ? "video/quicktime"
          : "video/mp4";
  const mimeType = asset.mimeType ?? fallbackMime;
  const name = asset.fileName ?? `return-${Date.now()}.${extFromUri || (kind === "image" ? "jpg" : "mp4")}`;
  return { uri, name, mimeType };
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  field: { gap: Spacing.xxs },
  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs, marginTop: Spacing.xxs },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbRemove: {
    position: "absolute",
    right: 2,
    top: 2,
    width: 18,
    height: 18,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    width: 64,
    height: 64,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  bankBox: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.sm, gap: Spacing.sm },
});
