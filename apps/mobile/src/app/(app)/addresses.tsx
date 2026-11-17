import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  AppText,
  Badge,
  Button,
  ErrorState,
  Screen,
  SelectField,
  TextField,
} from "@/components/ui";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/hooks/use-theme";
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  type AddressInput,
} from "@/lib/api/addresses";
import { getStates, type IndianStateDTO } from "@/lib/api/states";
import { Radius, Spacing } from "@/constants/theme";
import type { AddressDTO } from "@/lib/api/types";

type DealerLockedState = { id: string; name: string } | null;

function emptyForm(dealerLockedState: DealerLockedState): AddressInput {
  return {
    fullName: "",
    mobile: "",
    altMobile: null,
    line1: "",
    line2: null,
    landmark: null,
    cityTown: "",
    district: "",
    state: dealerLockedState?.name ?? "",
    stateId: dealerLockedState?.id ?? null,
    pincode: "",
    addressType: "HOME",
  };
}

export default function AddressesScreen() {
  const theme = useTheme();
  const { user, dealerStatus } = useAuth();
  // A dealer's delivery addresses are always locked to their own verified
  // state — same rule apps/web enforces (see address-form.tsx) and that the
  // server re-derives regardless of what's submitted (createAddress's
  // dealerLock param). Locking it in the UI too just avoids a confusing
  // "your address was saved to a different state than you picked" surprise.
  const dealerLockedState: DealerLockedState =
    user?.role === "DEALER" ? (dealerStatus?.dealerState ?? null) : null;
  const [addresses, setAddresses] = useState<AddressDTO[]>([]);
  const [states, setStates] = useState<IndianStateDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressInput>(() => emptyForm(dealerLockedState));
  const [saving, setSaving] = useState(false);

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm(dealerLockedState));
    setShowForm(true);
  }
  function startEdit(addr: AddressDTO) {
    setEditingId(addr.id);
    setForm({
      fullName: addr.fullName,
      mobile: addr.mobile,
      altMobile: addr.altMobile ?? null,
      line1: addr.line1,
      line2: addr.line2 ?? null,
      landmark: addr.landmark ?? null,
      cityTown: addr.cityTown,
      district: addr.district,
      state: addr.state,
      stateId: addr.stateId ?? null,
      pincode: addr.pincode,
      addressType: addr.addressType,
      isDefault: addr.isDefault,
    });
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm(dealerLockedState));
  }

  const load = useCallback(async () => {
    const [addrResult, stateResult] = await Promise.all([getAddresses(), getStates()]);
    if (!addrResult.ok) return setError(addrResult.error.message);
    setError(null);
    setAddresses(addrResult.data.addresses);
    if (stateResult.ok) setStates(stateResult.data.states);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    const state = dealerLockedState ?? states.find((s) => s.id === form.stateId);
    const payload = {
      ...form,
      state: state?.name ?? form.state,
      stateId: state?.id ?? form.stateId,
      pincode: form.pincode,
    };
    const result = editingId
      ? await updateAddress(editingId, payload)
      : await createAddress(payload);
    setSaving(false);
    if (result.ok) {
      closeForm();
      load();
    } else {
      setError(result.error.message);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {addresses.map((addr) => (
          <View key={addr.id} style={[styles.card, { borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <AppText variant="bodyBold">{addr.fullName}</AppText>
              {addr.isDefault ? <Badge label="Default" tone="success" /> : null}
            </View>
            <AppText variant="body" color="secondary">
              {addr.line1}, {addr.cityTown}, {addr.state} - {addr.pincode}
            </AppText>
            <AppText variant="caption" color="secondary">
              {addr.mobile}
            </AppText>
            <View style={styles.actionsRow}>
              <Pressable onPress={() => startEdit(addr)}>
                <AppText variant="caption" color="green">
                  Edit
                </AppText>
              </Pressable>
              {!addr.isDefault ? (
                <Pressable onPress={() => setDefaultAddress(addr.id).then(load)}>
                  <AppText variant="caption" color="green">
                    Set as default
                  </AppText>
                </Pressable>
              ) : null}
              <Pressable onPress={() => deleteAddress(addr.id).then(load)}>
                <AppText variant="caption" color="danger">
                  Delete
                </AppText>
              </Pressable>
            </View>
          </View>
        ))}

        {dealerLockedState ? (
          <AppText variant="caption" color="secondary">
            As a dealer, all your delivery addresses are locked to your verified state (
            {dealerLockedState.name}).
          </AppText>
        ) : null}

        {showForm ? (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <AppText variant="bodyBold">{editingId ? "Edit address" : "New address"}</AppText>
            <TextField
              label="Full name"
              value={form.fullName}
              onChangeText={(v) => setForm((f) => ({ ...f, fullName: v }))}
            />
            <TextField
              label="Mobile"
              keyboardType="phone-pad"
              value={form.mobile}
              onChangeText={(v) => setForm((f) => ({ ...f, mobile: v }))}
            />
            <TextField
              label="Address line 1"
              value={form.line1}
              onChangeText={(v) => setForm((f) => ({ ...f, line1: v }))}
              multiline
            />
            <TextField
              label="Address line 2 (optional)"
              value={form.line2 ?? ""}
              onChangeText={(v) => setForm((f) => ({ ...f, line2: v || null }))}
            />
            <TextField
              label="Town / City"
              value={form.cityTown}
              onChangeText={(v) => setForm((f) => ({ ...f, cityTown: v }))}
            />
            <TextField
              label="District"
              value={form.district}
              onChangeText={(v) => setForm((f) => ({ ...f, district: v }))}
            />
            {dealerLockedState ? (
              <TextField label="State" value={dealerLockedState.name} editable={false} />
            ) : (
              <SelectField
                label="State"
                value={form.stateId}
                onChange={(v) => setForm((f) => ({ ...f, stateId: v }))}
                options={states.map((s) => ({ label: s.name, value: s.id }))}
              />
            )}
            <TextField
              label="Pincode"
              keyboardType="number-pad"
              maxLength={6}
              value={form.pincode}
              onChangeText={(v) => setForm((f) => ({ ...f, pincode: v.replace(/[^0-9]/g, "").slice(0, 6) }))}
            />
            <Button
              label={editingId ? "Save changes" : "Save address"}
              onPress={handleSave}
              loading={saving}
              fullWidth
            />
            <Button label="Cancel" variant="ghost" onPress={closeForm} />
          </View>
        ) : (
          <Button label="Add new address" variant="outline" onPress={startAdd} fullWidth />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actionsRow: { flexDirection: "row", gap: Spacing.lg },
});
