import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ACCOUNT_NUMBER_REGEX, IFSC_REGEX, PAN_REGEX } from "@kisan4u/validators";
import {
  AppText,
  Badge,
  Button,
  Card,
  DocUploadField,
  TextField,
  type UploadedDocument,
} from "@/components/ui";
import { submitBaForm2, uploadBaDocument, type BaProfileDTO } from "@/lib/api/ba";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";

type FormState = {
  panNumber: string;
  bankName: string;
  bankBranch: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
};

const EMPTY: FormState = {
  panNumber: "",
  bankName: "",
  bankBranch: "",
  accountHolderName: "",
  accountNumber: "",
  ifsc: "",
};

export function BankDetailsForm({ profile, onSaved }: { profile: BaProfileDTO; onSaved: () => void }) {
  const theme = useTheme();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [panDoc, setPanDoc] = useState<UploadedDocument | null>(null);
  const [chequeDoc, setChequeDoc] = useState<UploadedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      panNumber: profile.panNumber ?? "",
      bankName: profile.bankName ?? "",
      bankBranch: profile.bankBranch ?? "",
      accountHolderName: profile.accountHolderName ?? "",
      accountNumber: profile.accountNumber ?? "",
      ifsc: profile.ifsc ?? "",
    });
    setPanDoc(profile.panDocKey ? { name: "PAN document on file", url: profile.panDocKey } : null);
    setChequeDoc(
      profile.chequeDocKey ? { name: "Cancelled cheque on file", url: profile.chequeDocKey } : null,
    );
  }, [profile]);

  const validationError = useMemo(() => {
    if (!PAN_REGEX.test(form.panNumber)) return "Enter a valid 10-character PAN.";
    if (form.bankName.trim().length < 2) return "Enter your bank name.";
    if (form.bankBranch.trim().length < 2) return "Enter your bank branch.";
    if (form.accountHolderName.trim().length < 2) return "Enter the account holder's name.";
    if (!ACCOUNT_NUMBER_REGEX.test(form.accountNumber)) return "Enter a valid 6–20 digit account number.";
    if (!IFSC_REGEX.test(form.ifsc)) return "Enter a valid 11-character IFSC code.";
    if (!panDoc || !chequeDoc) return "Upload both the PAN copy and cancelled cheque.";
    return null;
  }, [form, panDoc, chequeDoc]);

  if (profile.bankStatus === "APPROVED") {
    return (
      <Card style={styles.card}>
        <View style={styles.headingRow}>
          <AppText variant="subtitle">Bank & KYC details</AppText>
          <Badge label="Approved" tone="success" />
        </View>
        <AppText variant="body" color="secondary">
          Your bank details are approved and available for Business Associate payouts.
        </AppText>
      </Card>
    );
  }

  if (profile.bankStatus === "PENDING_APPROVAL") {
    return (
      <Card style={styles.card}>
        <View style={styles.headingRow}>
          <AppText variant="subtitle">Bank & KYC details</AppText>
          <Badge label="Under review" tone="warning" />
        </View>
        <AppText variant="body" color="secondary">
          Your PAN, bank details and documents were submitted. The Kisan4U team is reviewing them.
        </AppText>
      </Card>
    );
  }

  async function save() {
    setError(null);
    if (validationError || !panDoc || !chequeDoc) {
      setError(validationError ?? "Complete all bank details.");
      return;
    }
    setSaving(true);
    const result = await submitBaForm2({
      panNumber: form.panNumber.trim().toUpperCase(),
      panDocKey: panDoc.url,
      bankName: form.bankName.trim(),
      bankBranch: form.bankBranch.trim(),
      accountHolderName: form.accountHolderName.trim(),
      accountNumber: form.accountNumber.trim(),
      ifsc: form.ifsc.trim().toUpperCase(),
      chequeDocKey: chequeDoc.url,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSaved();
  }

  return (
    <View style={styles.stack}>
      {profile.bankStatus === "REJECTED" ? (
        <View style={[styles.alert, { backgroundColor: theme.dangerBg }]}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyBold" style={{ color: theme.danger }}>Bank details need changes</AppText>
            <AppText variant="caption" style={{ color: theme.danger }}>
              {profile.bankRejectionReason ?? "Review the details and submit them again."}
            </AppText>
          </View>
        </View>
      ) : null}

      <Card style={styles.card}>
        <AppText variant="label" color="secondary">PAN & BANK DETAILS</AppText>
        <TextField
          label="PAN number"
          value={form.panNumber}
          onChangeText={(value) => setForm((state) => ({ ...state, panNumber: value.toUpperCase().slice(0, 10) }))}
          autoCapitalize="characters"
          error={form.panNumber && !PAN_REGEX.test(form.panNumber) ? "Use format ABCDE1234F" : undefined}
        />
        <TextField label="Bank name" value={form.bankName} onChangeText={(bankName) => setForm((s) => ({ ...s, bankName }))} />
        <TextField label="Bank branch" value={form.bankBranch} onChangeText={(bankBranch) => setForm((s) => ({ ...s, bankBranch }))} />
        <TextField
          label="Account holder name"
          value={form.accountHolderName}
          onChangeText={(accountHolderName) => setForm((s) => ({ ...s, accountHolderName }))}
        />
        <TextField
          label="Account number"
          value={form.accountNumber}
          keyboardType="number-pad"
          maxLength={20}
          onChangeText={(value) => setForm((s) => ({ ...s, accountNumber: value.replace(/\D/g, "") }))}
          error={form.accountNumber && !ACCOUNT_NUMBER_REGEX.test(form.accountNumber) ? "Use 6–20 digits" : undefined}
        />
        <TextField
          label="IFSC code"
          value={form.ifsc}
          maxLength={11}
          autoCapitalize="characters"
          onChangeText={(value) => setForm((s) => ({ ...s, ifsc: value.toUpperCase() }))}
          error={form.ifsc && !IFSC_REGEX.test(form.ifsc) ? "Use format HDFC0001234" : undefined}
        />
      </Card>

      <Card style={styles.card}>
        <AppText variant="label" color="secondary">DOCUMENTS</AppText>
        <DocUploadField
          label="PAN card copy"
          value={panDoc}
          onChange={setPanDoc}
          upload={uploadBaDocument}
          onError={setError}
          onBusyChange={setUploading}
        />
        <DocUploadField
          label="Cancelled cheque"
          value={chequeDoc}
          onChange={setChequeDoc}
          upload={uploadBaDocument}
          onError={setError}
          onBusyChange={setUploading}
        />
      </Card>

      {error ? (
        <View style={[styles.alert, { backgroundColor: theme.dangerBg }]}>
          <Ionicons name="warning-outline" size={17} color={theme.danger} />
          <AppText variant="caption" style={{ color: theme.danger, flex: 1 }}>{error}</AppText>
        </View>
      ) : null}
      <Button
        label={profile.bankStatus === "REJECTED" ? "Resubmit bank details" : "Save bank details"}
        onPress={save}
        loading={saving}
        disabled={!!validationError || uploading}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.md },
  card: { gap: Spacing.sm },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm },
  alert: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.xs, padding: Spacing.sm, borderRadius: 10 },
});
