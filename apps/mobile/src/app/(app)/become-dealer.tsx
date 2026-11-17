import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GSTIN_REGEX } from "@kisan4u/validators";
import {
  AppText,
  Button,
  Card,
  DocUploadField,
  Screen,
  SelectField,
  TextField,
  type UploadedDocument,
} from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { getStates, type IndianStateDTO } from "@/lib/api/states";
import {
  getDealerApplication,
  submitDealerApplication,
  uploadDealerDocument,
  type DealerApplicationStatusDTO,
} from "@/lib/api/dealer";
import { Radius, Spacing } from "@/constants/theme";
import { openPrivateDocument } from "@/lib/api/documents";

/**
 * "Become a Dealer" for a signed-in customer. Same business details the
 * website collects at /register/dealer, but the account already exists so
 * submitting just attaches a PENDING DealerProfile — the customer keeps
 * shopping as a customer until an admin approves
 * (packages/auth/src/dealer-application.ts). A PENDING / REJECTED
 * application reopens here prefilled for edit + resubmit.
 */

const PERKS = [
  { icon: "pricetag-outline" as const, label: "Bulk pricing" },
  { icon: "cube-outline" as const, label: "Dealer catalogue" },
  { icon: "headset-outline" as const, label: "Priority support" },
];

export default function BecomeDealerScreen() {
  const theme = useTheme();
  const { refreshProfile } = useAuth();
  const [states, setStates] = useState<IndianStateDTO[]>([]);
  const [application, setApplication] = useState<DealerApplicationStatusDTO | null>(null);
  const [loadingPrefill, setLoadingPrefill] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateId, setStateId] = useState<string | null>(null);
  const [pincode, setPincode] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [gstDoc, setGstDoc] = useState<UploadedDocument | null>(null);
  const [licenseDoc, setLicenseDoc] = useState<UploadedDocument | null>(null);
  const [gstUploading, setGstUploading] = useState(false);
  const [licenseUploading, setLicenseUploading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    getStates()
      .then((result) => {
        if (alive && result.ok) setStates(result.data.states);
      })
      .catch(() => {});
    getDealerApplication()
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          setApplication(result.data.application);
          const f = result.data.form;
          setName(f.name);
          setStoreName(f.storeName);
          setStoreAddress(f.storeAddress);
          setCity(f.city);
          setStateId(f.stateId || null);
          setPincode(f.pincode);
          setGstNumber(f.gstNumber);
          setLicenseNumber(f.licenseNumber);
          if (f.gstDocUrl) setGstDoc({ name: "GST document on file", url: f.gstDocUrl });
          if (f.licenseDocUrl)
            setLicenseDoc({ name: "Licence document on file", url: f.licenseDocUrl });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingPrefill(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const gstOk = !gstNumber.trim() || GSTIN_REGEX.test(gstNumber.trim().toUpperCase());
  const canSubmit = Boolean(
    name.trim() &&
    storeName.trim() &&
    storeAddress.trim() &&
    city.trim() &&
    stateId &&
    /^\d{6}$/.test(pincode) &&
    gstOk &&
    licenseNumber.trim().length >= 3 &&
    licenseDoc?.url &&
    !gstUploading &&
    !licenseUploading,
  );

  const banner = useMemo(() => {
    switch (application?.status) {
      case "PENDING":
        return {
          tone: theme.earth100,
          fg: theme.earth700,
          icon: "time-outline" as const,
          title: "Application under review",
          body: "You can keep shopping as a customer. Edit anything below and resubmit any time before it's approved.",
        };
      case "REJECTED":
        return {
          tone: theme.dangerBg,
          fg: theme.danger,
          icon: "alert-circle-outline" as const,
          title: "Application needs changes",
          body:
            application.rejectionReason ?? "Please review your details, correct them and resubmit.",
        };
      case "APPROVED":
        return {
          tone: theme.green50,
          fg: theme.green700,
          icon: "checkmark-circle-outline" as const,
          title: "You're an approved dealer",
          body: "Log out and back in to switch to your dealer account.",
        };
      default:
        return null;
    }
  }, [application, theme]);

  async function handleSubmit() {
    if (!stateId) return;
    if (!gstOk) {
      setError("Enter a valid 15-character GST number, or leave it blank.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await submitDealerApplication({
        name: name.trim(),
        storeName: storeName.trim(),
        storeAddress: storeAddress.trim(),
        city: city.trim(),
        stateId,
        pincode,
        gstNumber: gstNumber.trim() || undefined,
        licenseNumber: licenseNumber.trim() || undefined,
        gstDocUrl: gstDoc?.url || undefined,
        licenseDocUrl: licenseDoc?.url || undefined,
      });
      setLoading(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await refreshProfile().catch(() => {});
      setSubmitted(true);
    } catch {
      setLoading(false);
      setError("Something went wrong. Please try again.");
    }
  }

  if (submitted) {
    return (
      <Screen>
        <View style={styles.centre}>
          <View style={[styles.doneBadge, { backgroundColor: theme.green50 }]}>
            <Ionicons name="checkmark" size={40} color={theme.green700} />
          </View>
          <AppText variant="title" style={styles.centreText}>
            Application submitted
          </AppText>
          <AppText variant="body" color="secondary" style={styles.centreText}>
            Our team will review it shortly. Keep using your customer account meanwhile —
            you&apos;ll be switched to a dealer account automatically once it&apos;s approved.
          </AppText>
          <Button
            label="Back to shopping"
            onPress={() => router.replace("/(app)/(tabs)")}
            fullWidth
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: theme.green700 }]}>
          <View style={[styles.heroIcon, { backgroundColor: theme.onGreen }]}>
            <Ionicons name="ribbon" size={22} color={theme.green700} />
          </View>
          <AppText color="white" variant="title" style={styles.heroTitle}>
            Become a Dealer
          </AppText>
          <AppText color="white" variant="caption" style={styles.heroSub}>
            Tell us about your business. Your customer account stays active while we review this.
          </AppText>
          <View style={styles.perks}>
            {PERKS.map((p) => (
              <View key={p.label} style={styles.perk}>
                <Ionicons name={p.icon} size={13} color={theme.onGreen} />
                <AppText color="white" variant="label" style={styles.perkText}>
                  {p.label}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        {loadingPrefill ? (
          <View style={styles.prefillRow}>
            <ActivityIndicator size="small" color={theme.green700} />
            <AppText variant="caption" color="secondary">
              Loading your details…
            </AppText>
          </View>
        ) : null}

        {banner ? (
          <View style={[styles.banner, { backgroundColor: banner.tone }]}>
            <Ionicons name={banner.icon} size={18} color={banner.fg} style={{ marginTop: 1 }} />
            <View style={styles.bannerBody}>
              <AppText variant="bodyBold" style={{ color: banner.fg }}>
                {banner.title}
              </AppText>
              <AppText variant="caption" color="secondary">
                {banner.body}
              </AppText>
            </View>
          </View>
        ) : null}

        {/* Business details */}
        <Card style={styles.card}>
          <AppText variant="label" color="secondary" style={styles.cardLabel}>
            BUSINESS DETAILS
          </AppText>
          <TextField
            label="Your full name"
            value={name}
            onChangeText={setName}
            placeholder="Full name"
          />
          <TextField
            label="Store / business name"
            value={storeName}
            onChangeText={setStoreName}
            placeholder="Store name"
          />
          <TextField
            label="Store address"
            value={storeAddress}
            onChangeText={setStoreAddress}
            placeholder="Shop no., street, area"
            multiline
          />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <TextField label="City" value={city} onChangeText={setCity} placeholder="City" />
            </View>
            <View style={styles.rowItem}>
              <TextField
                label="Pincode"
                value={pincode}
                onChangeText={(v) => setPincode(v.replace(/[^0-9]/g, "").slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="6 digits"
              />
            </View>
          </View>
          <SelectField
            label="State"
            value={stateId}
            onChange={setStateId}
            options={states.map((s) => ({ label: s.name, value: s.id }))}
            placeholder="Select your state"
          />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <TextField
                label="GST number (optional)"
                value={gstNumber}
                onChangeText={setGstNumber}
                placeholder="15-char GSTIN"
                autoCapitalize="characters"
                error={gstOk ? null : "Enter a valid 15-character GST number"}
              />
            </View>
            <View style={styles.rowItem}>
              <TextField
                label="Licence number"
                value={licenseNumber}
                onChangeText={setLicenseNumber}
                placeholder="Licence no."
              />
            </View>
          </View>
        </Card>

        {/* Documents */}
        <Card style={styles.card}>
          <AppText variant="label" color="secondary" style={styles.cardLabel}>
            KYC DOCUMENTS
          </AppText>
          <AppText variant="caption" color="secondary" style={styles.docHint}>
            GST certificate is optional; a photo or PDF of your dealer licence is required. Up to 5
            MB each.
          </AppText>
          <DocUploadField
            label="GST certificate"
            value={gstDoc}
            onChange={setGstDoc}
            upload={uploadDealerDocument}
            onError={setError}
            onBusyChange={setGstUploading}
            onView={
              gstDoc?.name === "GST document on file"
                ? async () => {
                    await openPrivateDocument("dealer-gst");
                  }
                : undefined
            }
          />
          <DocUploadField
            label="Dealer licence"
            value={licenseDoc}
            onChange={setLicenseDoc}
            upload={uploadDealerDocument}
            onError={setError}
            onBusyChange={setLicenseUploading}
            onView={
              licenseDoc?.name === "Licence document on file"
                ? async () => {
                    await openPrivateDocument("dealer-licence");
                  }
                : undefined
            }
          />
        </Card>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: theme.dangerBg }]}>
            <Ionicons name="warning-outline" size={16} color={theme.danger} />
            <AppText variant="caption" style={{ color: theme.danger, flex: 1 }}>
              {error}
            </AppText>
          </View>
        ) : null}

        <Button
          label={application ? "Resubmit application" : "Submit application"}
          onPress={handleSubmit}
          loading={loading}
          disabled={!canSubmit}
          fullWidth
        />
        <AppText variant="caption" color="secondary" style={styles.footNote}>
          A Kisan4U team member reviews every application. You&apos;ll be notified once it&apos;s
          approved.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  centreText: { textAlign: "center" },
  doneBadge: {
    width: 84,
    height: 84,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  hero: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: 6,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  heroTitle: { fontWeight: "800" },
  heroSub: { opacity: 0.92, lineHeight: 17 },
  perks: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.sm },
  perk: { flexDirection: "row", alignItems: "center", gap: 4 },
  perkText: { opacity: 0.95 },
  prefillRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, paddingHorizontal: 4 },
  banner: {
    flexDirection: "row",
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  bannerBody: { flex: 1, gap: 2 },
  card: { gap: Spacing.sm, padding: Spacing.md },
  cardLabel: { letterSpacing: 0.5, marginBottom: 2 },
  docHint: { lineHeight: 16 },
  row: { flexDirection: "row", gap: Spacing.sm },
  rowItem: { flex: 1 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
  },
  footNote: { textAlign: "center", lineHeight: 16 },
});
