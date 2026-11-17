import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { AppText } from "./AppText";
import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";

export type UploadedDocument = { name: string; url: string };
export type DocumentUploadInput = { uri: string; name: string; mimeType: string };

export function DocUploadField({
  label,
  value,
  onChange,
  upload,
  onError,
  onBusyChange,
  onView,
  disabled,
}: {
  label: string;
  value: UploadedDocument | null;
  onChange: (value: UploadedDocument | null) => void;
  upload: (
    file: DocumentUploadInput,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  onError?: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onView?: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  async function pick() {
    onError?.("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = result.canceled ? null : result.assets?.[0];
      if (!asset) return;
      if ((asset.size ?? 0) > 5 * 1024 * 1024) {
        onError?.("That file is larger than 5 MB. Pick a smaller one.");
        return;
      }
      const mimeType =
        asset.mimeType ??
        (asset.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      setBusy(true);
      onBusyChange?.(true);
      const uploaded = await upload({
        uri: asset.uri,
        name: asset.name ?? "document",
        mimeType,
      });
      if (!uploaded.ok) {
        onError?.(`${label}: ${uploaded.error}`);
        return;
      }
      onChange({ name: asset.name ?? "Document uploaded", url: uploaded.url });
    } catch {
      onError?.("Couldn't open the file picker. Try again.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <View style={[styles.row, { borderColor: value ? theme.green600 : theme.border }]}>
      <View style={[styles.icon, { backgroundColor: theme.green50 }]}>
        <Ionicons
          name={value ? "document-text" : "cloud-upload-outline"}
          size={19}
          color={theme.green700}
        />
      </View>
      <View style={styles.body}>
        <AppText variant="bodyBold">{label}</AppText>
        <AppText variant="caption" color="secondary" numberOfLines={1}>
          {busy ? "Uploading…" : value ? value.name : "PDF or image, up to 5 MB"}
        </AppText>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={theme.green700} />
      ) : value ? (
        <View style={styles.actions}>
          {onView ? (
            <Pressable onPress={() => void onView()} hitSlop={6}>
              <AppText variant="label" color="green">
                View
              </AppText>
            </Pressable>
          ) : null}
          <Pressable onPress={pick} disabled={disabled} hitSlop={6}>
            <AppText variant="label" color="green">
              Replace
            </AppText>
          </Pressable>
          <Pressable onPress={() => onChange(null)} disabled={disabled} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={pick}
          disabled={disabled}
          style={[styles.uploadButton, { borderColor: theme.green700 }]}
        >
          <AppText variant="label" color="green">
            Upload
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  uploadButton: {
    borderWidth: 1.5,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
});
