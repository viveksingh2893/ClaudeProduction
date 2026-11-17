import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { baForm1Schema } from "@kisan4u/validators";
import { AppText, Button, Card, SelectField, TextField } from "@/components/ui";
import { getAddresses } from "@/lib/api/addresses";
import { getAccountContact, submitBaForm1, type BaProfileDTO } from "@/lib/api/ba";
import { getStates, type IndianStateDTO } from "@/lib/api/states";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";

type FormState = {
  firstName: string;
  lastName: string;
  contactNumber: string;
  email: string;
  pincode: string;
  state: string;
  city: string;
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  firstName: "",
  lastName: "",
  contactNumber: "",
  email: "",
  pincode: "",
  state: "",
  city: "",
};

/**
 * Business Associate Form 1. Everything we already know is filled in for
 * the user — an existing (e.g. rejected) application first, then their
 * account (name / verified phone / email), then their default address
 * (pincode / city / state). The contact number is compulsory and locked to
 * the verified account number (the server rejects any other value), and the
 * state is picked from the same list the address and dealer forms use.
 */
export function BasicDetailsForm({
  profile,
  onSubmitted,
}: {
  profile: BaProfileDTO | null;
  onSubmitted: () => void;
}) {
  const theme = useTheme();
  // The screen refetches on every focus / pull-to-refresh, handing us a new
  // profile object each time — pre-fill once from the first one so a refetch
  // never overwrites what the user has typed.
  const initialProfile = useRef(profile).current;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [states, setStates] = useState<IndianStateDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [me, stateRes, addrRes] = await Promise.all([
        getAccountContact(),
        getStates(),
        getAddresses(),
      ]);
      if (!alive) return;

      const stateList = stateRes.ok ? stateRes.data.states : [];
      const addresses = addrRes.ok ? addrRes.data.addresses : [];
      const address = addresses.find((a) => a.isDefault) ?? addresses[0];
      const user = me.ok ? me.data.user : null;

      // Saved states are free text on older applications/addresses — only
      // pre-select one that matches the dropdown list, otherwise leave it
      // for the user to choose.
      const matchState = (name: string | undefined) =>
        stateList.find((s) => s.name.toLowerCase() === (name ?? "").trim().toLowerCase())?.name ??
        "";

      setStates(stateList);
      setForm({
        firstName: initialProfile?.firstName || user?.firstName || "",
        lastName: initialProfile?.lastName || user?.lastName || "",
        // The verified account number always wins — a BA's contact number
        // must equal it, so it's never taken from the (editable) old profile.
        contactNumber: user?.phone ?? initialProfile?.contactNumber ?? "",
        email: initialProfile?.email || user?.email || "",
        pincode: initialProfile?.pincode || address?.pincode || "",
        state: matchState(initialProfile?.state) || matchState(address?.state),
        city: initialProfile?.city || address?.cityTown || "",
      });
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [initialProfile]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setFormError(null);
  }

  async function submit() {
    setFormError(null);
    const parsed = baForm1Schema.safeParse(form);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormState | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setSaving(true);
    const res = await submitBaForm1(parsed.data);
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error.message);
      return;
    }
    onSubmitted();
  }

  const stateOptions = states.map((s) => ({ label: s.name, value: s.name }));
  const noPhone = !loading && form.contactNumber.length === 0;

  return (
    <Card style={styles.card}>
      <AppText variant="subtitle">Basic details</AppText>
      {loading ? (
        <AppText color="secondary">Loading your details…</AppText>
      ) : (
        <>
          <TextField
            label="First name"
            value={form.firstName}
            onChangeText={(v) => set("firstName", v)}
            error={errors.firstName}
          />
          <TextField
            label="Last name"
            value={form.lastName}
            onChangeText={(v) => set("lastName", v)}
            error={errors.lastName}
          />
          <View style={styles.phoneWrap}>
            <TextField
              label="Contact number *"
              value={form.contactNumber}
              editable={false}
              keyboardType="phone-pad"
              style={{ backgroundColor: theme.background, color: theme.textSecondary }}
              error={errors.contactNumber}
            />
            <AppText variant="caption" color="secondary">
              This is the verified number on your account, so it can&apos;t be changed here.
            </AppText>
          </View>
          <TextField
            label="Email"
            value={form.email}
            onChangeText={(v) => set("email", v)}
            keyboardType="email-address"
            autoCapitalize="none"
            error={errors.email}
          />
          <TextField
            label="Pincode"
            value={form.pincode}
            onChangeText={(v) => set("pincode", v.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            error={errors.pincode}
          />
          <SelectField
            label="State"
            value={form.state || null}
            options={stateOptions}
            onChange={(v) => set("state", v)}
            placeholder="Select your state"
            error={errors.state}
          />
          <TextField
            label="City"
            value={form.city}
            onChangeText={(v) => set("city", v)}
            error={errors.city}
          />
          {noPhone ? (
            <AppText variant="caption" color="danger">
              We couldn&apos;t find a verified mobile number on your account. Log in with your mobile
              number to apply.
            </AppText>
          ) : null}
          {formError ? (
            <AppText variant="caption" color="danger">
              {formError}
            </AppText>
          ) : null}
          <Button
            label="Submit application"
            onPress={submit}
            loading={saving}
            disabled={noPhone}
            fullWidth
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  phoneWrap: { gap: Spacing.xxs },
});
