import { useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { GSTIN_REGEX } from "@kisan4u/validators";
import { AppText, Button, SelectField, TextField } from "@/components/ui";
import { getStates, type IndianStateDTO } from "@/lib/api/states";
import { submitDealerRegistration, uploadDealerRegistrationDocument } from "@/lib/api/dealer";
import { Spacing } from "@/constants/theme";

type DocSlot = { name: string; url: string } | null;

export default function DealerRegisterDetailsScreen() {
  const { onboardingSessionId } = useLocalSearchParams<{ onboardingSessionId: string }>();
  const [states, setStates] = useState<IndianStateDTO[]>([]);
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateId, setStateId] = useState<string | null>(null);
  const [pincode, setPincode] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [gstDoc, setGstDoc] = useState<DocSlot>(null);
  const [licenseDoc, setLicenseDoc] = useState<DocSlot>(null);
  const [uploading, setUploading] = useState<"gst" | "license" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getStates().then((result) => {
      if (result.ok) setStates(result.data.states);
    });
  }, []);

  const gstOk = !gstNumber.trim() || GSTIN_REGEX.test(gstNumber.trim().toUpperCase());
  const canSubmit =
    !!name &&
    !!storeName &&
    !!storeAddress &&
    !!city &&
    !!stateId &&
    /^\d{6}$/.test(pincode) &&
    gstOk &&
    licenseNumber.trim().length >= 3 &&
    !!licenseDoc?.url;

  async function pickDoc(slot: "gst" | "license") {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const mimeType =
        asset.mimeType ??
        (asset.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      if ((asset.size ?? 0) > 5 * 1024 * 1024) {
        setError("That file is larger than 5 MB. Pick a smaller one.");
        return;
      }
      setUploading(slot);
      const up = await uploadDealerRegistrationDocument(onboardingSessionId, {
        uri: asset.uri,
        name: asset.name ?? `${slot}-document`,
        mimeType,
      });
      setUploading(null);
      if (!up.ok) {
        setError(`${slot === "gst" ? "GST" : "Licence"} document: ${up.error}`);
        return;
      }
      const value = { name: asset.name ?? "Document uploaded", url: up.url };
      if (slot === "gst") setGstDoc(value);
      else setLicenseDoc(value);
    } catch {
      setUploading(null);
      setError("Couldn't open the file picker. Try again.");
    }
  }

  async function handleSubmit() {
    if (!stateId) return;
    if (!gstOk) {
      setError("Enter a valid 15-character GST number, or leave it blank.");
      return;
    }
    setError(null);
    setLoading(true);
    const result = await submitDealerRegistration({
      onboardingSessionId,
      name,
      storeName,
      storeAddress,
      city,
      stateId,
      pincode,
      gstNumber: gstNumber.trim() || undefined,
      licenseNumber: licenseNumber.trim(),
      gstDocUrl: gstDoc?.url || undefined,
      licenseDocUrl: licenseDoc?.url ?? "",
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.replace({
      pathname: "/(auth)/dealer-register/status",
      params: { statusViewSessionId: result.data.statusViewSessionId },
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <AppText variant="subtitle">Business details</AppText>
      <TextField label="Your full name" value={name} onChangeText={setName} placeholder="Full name" />
      <TextField label="Store / business name" value={storeName} onChangeText={setStoreName} placeholder="Store name" />
      <TextField label="Store address" value={storeAddress} onChangeText={setStoreAddress} placeholder="Full address" multiline />
      <TextField label="City" value={city} onChangeText={setCity} placeholder="City" />
      <SelectField
        label="State"
        value={stateId}
        onChange={setStateId}
        options={states.map((s) => ({ label: s.name, value: s.id }))}
        placeholder="Select your state"
      />
      <TextField
        label="Pincode"
        value={pincode}
        onChangeText={(v) => setPincode(v.replace(/[^0-9]/g, "").slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="6-digit pincode"
      />
      <TextField
        label="GST number (optional)"
        value={gstNumber}
        onChangeText={setGstNumber}
        placeholder="15-character GSTIN"
        autoCapitalize="characters"
        error={gstOk ? null : "Enter a valid 15-character GST number"}
      />
      <TextField
        label="Licence number"
        value={licenseNumber}
        onChangeText={setLicenseNumber}
        placeholder="Your dealer licence number"
      />

      <Button
        label={gstDoc ? `GST copy: ${gstDoc.name}` : uploading === "gst" ? "Uploading…" : "Upload GST copy (optional)"}
        variant="outline"
        onPress={() => pickDoc("gst")}
        disabled={uploading !== null}
        fullWidth
      />
      <Button
        label={
          licenseDoc
            ? `Licence copy: ${licenseDoc.name}`
            : uploading === "license"
              ? "Uploading…"
              : "Upload licence copy (required)"
        }
        variant="outline"
        onPress={() => pickDoc("license")}
        disabled={uploading !== null}
        fullWidth
      />

      {error ? (
        <AppText variant="body" color="danger">
          {error}
        </AppText>
      ) : null}
      <Button label="Submit application" onPress={handleSubmit} loading={loading} disabled={!canSubmit} fullWidth />
      <AppText variant="caption" color="secondary" style={styles.note}>
        A Kisan4U team member will review your application. You&apos;ll be notified once it&apos;s approved.
      </AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.xxl },
  note: { textAlign: "center" },
});
